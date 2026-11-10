/**
 * engine.ts
 *
 * The single entry point for player actions during a game. Every action is
 * a command; processCommand checks that it's legal and returns either a new
 * GameState or the reason it was refused. The socket layer never changes
 * game state directly.
 *
 * Mulligan decisions live in mulligan.ts and will be folded into this
 * command boundary later.
 */

import { randomUUID } from "crypto";
import type {
  BattlefieldCard,
  GameState,
  StackObject,
} from "../../../shared/src/types";
import { parseManaCost, planPayment } from "./mana";
import { findPlayer, replacePlayer } from "./stateHelpers";
import { passPriority } from "./turns";

export const MAX_LAND_DROPS = 1;

export type GameCommand =
  | { type: "PASS_PRIORITY"; playerId: string }
  | { type: "PLAY_LAND"; playerId: string; cardInstanceId: string }
  | { type: "CAST_SPELL"; playerId: string; cardInstanceId: string };

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
 * Supported this week: creature spells, at sorcery speed. Instants and
 * sorceries need spell effects and arrive next week.
 */
function castSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string
): CommandResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");

  const player = findPlayer(state, playerId);
  if (!player) return fail("You're not in this game.");
  if (state.priorityPlayerId !== playerId) return fail("You don't have priority.");

  const card = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!card) return fail("That card isn't in your hand.");

  const types = card.card.types;
  if (types.includes("Land")) {
    return fail("Lands aren't cast. Play it as your land drop instead.");
  }
  if (!types.includes("Creature")) {
    return fail("That kind of spell isn't supported yet.");
  }

  // Creature spells are sorcery speed: your turn, a main phase, empty stack.
  if (state.activePlayerId !== playerId) {
    return fail("You can only cast a creature on your own turn.");
  }
  if (state.phase !== "main1" && state.phase !== "main2") {
    return fail("You can only cast a creature during a main phase.");
  }
  if (state.stack.length > 0) {
    return fail("You can only cast a creature when the stack is empty.");
  }

  const cost = parseManaCost(card.card.manaCost);
  if (!cost) {
    return fail(`${card.card.name} has a mana cost that isn't supported yet.`);
  }

  const toTap = planPayment(player.battlefield, cost);
  if (!toTap) {
    return fail(`You can't pay ${card.card.manaCost || "{0}"} for ${card.card.name}.`);
  }
  const tapped = new Set(toTap);

  const spell: StackObject = {
    id: randomUUID(),
    controllerId: playerId,
    source: card,
    kind: "spell",
    targets: [],
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

export function processCommand(state: GameState, command: GameCommand): CommandResult {
  switch (command.type) {
    case "PASS_PRIORITY":
      return passPriority(state, command.playerId);
    case "PLAY_LAND":
      return playLand(state, command.playerId, command.cardInstanceId);
    case "CAST_SPELL":
      return castSpell(state, command.playerId, command.cardInstanceId);
  }
}