/**
 * engine.ts
 *
 * The single entry point for player actions during a game. Every action is
 * a command; processCommand checks that it's legal and returns either a new
 * GameState or the reason it was refused. The socket layer never changes
 * game state directly.
 *
 * After every successful command, state-based actions run (creatures with
 * lethal damage die, players at 0 life lose).
 *
 * Mulligan decisions live in mulligan.ts and will be folded into this
 * command boundary later.
 */

import { randomUUID } from "crypto";
import type {
  BattlefieldCard,
  GameState,
  StackObject,
  Target,
} from "../../../shared/src/types";
import { effectTargetSpec, getSpellEffect, targetProblem } from "./effects";
import { parseManaCost, planPayment } from "./mana";
import { applyStateBasedActions } from "./sba";
import { findPlayer, replacePlayer } from "./stateHelpers";
import { passPriority } from "./turns";

export const MAX_LAND_DROPS = 1;

export type GameCommand =
  | { type: "PASS_PRIORITY"; playerId: string }
  | { type: "PLAY_LAND"; playerId: string; cardInstanceId: string }
  | { type: "CAST_SPELL"; playerId: string; cardInstanceId: string; targets?: Target[] };

export type CommandResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

function playLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string
): CommandResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");

  const player = findPlayer(state, playerId);
  if (!player) return fail("You're not in this game.");

  if (state.activePlayerId !== playerId) return fail("It's not your turn.");
  if (state.priorityPlayerId !== playerId) return fail("You don't have priority.");
  if (state.phase !== "main1" && state.phase !== "main2") {
    return fail("You can only play a land during a main phase.");
  }
  if (state.stack.length > 0) {
    return fail("You can only play a land when the stack is empty.");
  }
  if (player.landsPlayedThisTurn >= MAX_LAND_DROPS) {
    return fail("You've already played a land this turn.");
  }

  const card = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!card) return fail("That card isn't in your hand.");
  if (!card.card.types.includes("Land")) return fail("That card isn't a land.");

  const permanent: BattlefieldCard = {
    ...card,
    controllerId: playerId,
    tapped: false,
    summoningSick: false,
    damageMarked: 0,
    powerModifier: 0,
    toughnessModifier: 0,
    attacking: false,
  };

  const next = replacePlayer(state, {
    ...player,
    hand: player.hand.filter((c) => c.instanceId !== cardInstanceId),
    battlefield: [...player.battlefield, permanent],
    landsPlayedThisTurn: player.landsPlayedThisTurn + 1,
  });

  // Playing a land is an action, so any earlier passes no longer count.
  return { ok: true, state: { ...next, consecutivePasses: 0 } };
}

/**
 * Casting puts the spell on the stack and taps the permanents that pay for
 * it. The caster keeps priority. The spell does nothing until both players
 * pass and it resolves (see stack.ts).
 *
 * Timing:
 *   - Instants: any time you have priority, even with the stack non-empty.
 *   - Creatures and sorceries: sorcery speed (your turn, a main phase,
 *     empty stack).
 * Not supported yet: enchantments, artifacts, and any instant or sorcery
 * whose effect isn't one of the three in effects.ts.
 */
function castSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: Target[]
): CommandResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");

  const player = findPlayer(state, playerId);
  if (!player) return fail("You're not in this game.");
  if (state.priorityPlayerId !== playerId) return fail("You don't have priority.");

  const card = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!card) return fail("That card isn't in your hand.");

  const name = card.card.name;
  const types = card.card.types;
  if (types.includes("Land")) {
    return fail("Lands aren't cast. Play it as your land drop instead.");
  }

  const isInstant = types.includes("Instant");
  const isCreature = types.includes("Creature");
  const isSorcery = types.includes("Sorcery");
  if (!isInstant && !isCreature && !isSorcery) {
    return fail("That kind of spell isn't supported yet.");
  }

  // Creatures and sorceries need an effect-free check or a supported effect.
  const effect = isCreature ? null : getSpellEffect(card.card);
  if (!isCreature && !effect) {
    return fail(`${name}'s effect isn't supported yet.`);
  }

  // Everything except an instant is sorcery speed.
  if (!isInstant) {
    if (state.activePlayerId !== playerId) {
      return fail(`You can only cast ${name} on your own turn.`);
    }
    if (state.phase !== "main1" && state.phase !== "main2") {
      return fail(`You can only cast ${name} during a main phase.`);
    }
    if (state.stack.length > 0) {
      return fail(`You can only cast ${name} when the stack is empty.`);
    }
  }

  // Targets (creatures don't use them).
  let chosenTargets: Target[] = [];
  if (effect) {
    if (targets.length !== 1) return fail("Choose exactly one target.");
    const problem = targetProblem(state, effectTargetSpec(effect), targets[0]);
    if (problem) return fail(problem);
    chosenTargets = targets;
  }

  // Payment.
  const cost = parseManaCost(card.card.manaCost);
  if (!cost) {
    return fail(`${name} has a mana cost that isn't supported yet.`);
  }
  const toTap = planPayment(player.battlefield, cost);
  if (!toTap) {
    return fail(`You can't pay ${card.card.manaCost || "{0}"} for ${name}.`);
  }
  const tapped = new Set(toTap);

  const spell: StackObject = {
    id: randomUUID(),
    controllerId: playerId,
    source: card,
    kind: "spell",
    targets: chosenTargets,
  };

  const next = replacePlayer(state, {
    ...player,
    hand: player.hand.filter((c) => c.instanceId !== cardInstanceId),
    battlefield: player.battlefield.map((p) =>
      tapped.has(p.instanceId) ? { ...p, tapped: true } : p
    ),
  });

  return {
    ok: true,
    state: { ...next, stack: [...next.stack, spell], consecutivePasses: 0 },
  };
}

function runCommand(state: GameState, command: GameCommand): CommandResult {
  switch (command.type) {
    case "PASS_PRIORITY":
      return passPriority(state, command.playerId);
    case "PLAY_LAND":
      return playLand(state, command.playerId, command.cardInstanceId);
    case "CAST_SPELL":
      return castSpell(state, command.playerId, command.cardInstanceId, command.targets ?? []);
  }
}

export function processCommand(state: GameState, command: GameCommand): CommandResult {
  const result = runCommand(state, command);
  if (!result.ok) return result;
  return { ok: true, state: applyStateBasedActions(result.state) };
}