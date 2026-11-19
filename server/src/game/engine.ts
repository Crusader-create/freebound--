/**
 * engine.ts
 *
 * The single entry point for player actions during a game. Every action is
 * a command; processCommand checks that it's legal and returns either a new
 * GameState or the reason it was refused. The socket layer never changes
 * game state directly.
 *
 * After every successful command:
 *   1. State-based actions run (creatures with lethal damage die, players at
 *      0 life lose).
 *   2. Any triggered abilities waiting in pendingTriggers go on the stack.
 *      A trigger that needs a target first waits for its controller to
 *      choose one (awaiting = "trigger_target").
 * This is the "detect, queue, then put on the stack at the right moment"
 * order: a trigger never resolves the instant it triggers.
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
import {
  declareAttackers,
  declareBlockers,
  type BlockAssignment,
} from "./combat";
import { hasSomethingToDo } from "./autoPass";
import { effectTargetSpec, getSpellEffect, targetProblem } from "./effects";
import { log, p, P } from "./log";
import { findPermanent } from "./permanents";
import { parseManaCost, planPayment } from "./mana";
import { applyStateBasedActions } from "./sba";
import { findPlayer, getPlayer, opponentOf, replacePlayer } from "./stateHelpers";
import { finishCleanup, MAX_HAND_SIZE, passPriority } from "./turns";

export const MAX_LAND_DROPS = 1;

export type GameCommand =
  | { type: "PASS_PRIORITY"; playerId: string }
  | { type: "PLAY_LAND"; playerId: string; cardInstanceId: string }
  | { type: "CAST_SPELL"; playerId: string; cardInstanceId: string; targets?: Target[] }
  | { type: "DECLARE_ATTACKERS"; playerId: string; attackerIds: string[] }
  | { type: "DECLARE_BLOCKERS"; playerId: string; blocks: BlockAssignment[] }
  | { type: "CHOOSE_TRIGGER_TARGET"; playerId: string; target: Target }
  | { type: "DISCARD"; playerId: string; cardInstanceIds: string[] }
  | { type: "CONCEDE"; playerId: string };

export type CommandResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

/** A target as it should read in the log: a player, or a creature by name. */
function describeTarget(state: GameState, target: Target): string {
  if (target.kind === "player") return p(target.playerId);
  if (target.kind === "permanent") {
    const found = findPermanent(state, target.instanceId);
    return found ? `${P(found.controller.id)} ${found.permanent.card.name}` : "a creature";
  }
  return "a spell";
}

/** Why a normal action can't happen while the game waits on a decision. */
function awaitingReason(state: GameState): string | null {
  switch (state.awaiting) {
    case "attackers":
      return "Declare attackers first.";
    case "blockers":
      return "Declare blockers first.";
    case "trigger_target":
      return "A triggered ability needs a target first.";
    case "discard":
      return "Discard down to hand size first.";
    default:
      return null;
  }
}

function playLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string
): CommandResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");
  const waiting = awaitingReason(state);
  if (waiting) return fail(waiting);

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
  return {
    ok: true,
    state: log({ ...next, consecutivePasses: 0 }, `${p(playerId)} played ${card.card.name}.`),
  };
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
 *   - Auras (only Pacifism-style ones so far): sorcery speed, and they
 *     target the creature they'll enchant.
 * Not supported yet: other enchantments, artifacts, and any instant or
 * sorcery whose effect isn't one in effects.ts.
 */
function castSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: Target[]
): CommandResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");
  const waiting = awaitingReason(state);
  if (waiting) return fail(waiting);

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
  // Creatures need no effect; everything else needs one the engine understands.
  const effect = isCreature ? null : getSpellEffect(card.card);
  const isAura = effect?.kind === "pacify";
  if (!isInstant && !isCreature && !isSorcery && !isAura) {
    return fail("That kind of spell isn't supported yet.");
  }
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

  const targetText = chosenTargets[0] ? ` targeting ${describeTarget(state, chosenTargets[0])}` : "";
  return {
    ok: true,
    state: log(
      { ...next, stack: [...next.stack, spell], consecutivePasses: 0 },
      `${p(playerId)} cast ${name}${targetText}.`
    ),
  };
}

/**
 * The controller of the first pending trigger picks its target. The trigger
 * then goes on the stack and priority returns to the active player.
 */
function chooseTriggerTarget(state: GameState, playerId: string, target: Target): CommandResult {
  if (state.awaiting !== "trigger_target") return fail("Nothing is waiting for a target.");
  const pending = state.pendingTriggers[0];
  if (!pending) return fail("Nothing is waiting for a target.");
  if (pending.controllerId !== playerId) return fail("That isn't your ability to target.");

  const problem = targetProblem(state, "any", target);
  if (problem) return fail(problem);

  const ability: StackObject = {
    id: randomUUID(),
    controllerId: playerId,
    source: pending.source,
    kind: "triggered_ability",
    targets: [target],
    description: pending.description,
  };

  return {
    ok: true,
    state: log(
      {
        ...state,
        stack: [...state.stack, ability],
        pendingTriggers: state.pendingTriggers.slice(1),
        awaiting: null,
        priorityPlayerId: state.activePlayerId,
        consecutivePasses: 0,
      },
      `${pending.source.card.name}'s ability triggered, targeting ${describeTarget(state, target)}.`
    ),
  };
}

/** During cleanup, the active player discards down to the maximum hand size. */
function discard(state: GameState, playerId: string, cardInstanceIds: string[]): CommandResult {
  if (state.awaiting !== "discard") return fail("You don't need to discard right now.");
  if (state.priorityPlayerId !== playerId) return fail("It isn't your turn to discard.");

  const player = getPlayer(state, playerId);
  const needed = player.hand.length - MAX_HAND_SIZE;
  const chosen = new Set(cardInstanceIds);
  if (chosen.size !== cardInstanceIds.length) return fail("A card can only be discarded once.");
  if (chosen.size !== needed) return fail(`Choose exactly ${needed} card(s) to discard.`);
  if (![...chosen].every((id) => player.hand.some((c) => c.instanceId === id))) {
    return fail("One of those cards isn't in your hand.");
  }

  const discarded = player.hand.filter((c) => chosen.has(c.instanceId));
  const next = replacePlayer(state, {
    ...player,
    hand: player.hand.filter((c) => !chosen.has(c.instanceId)),
    graveyard: [...player.graveyard, ...discarded],
  });
  const names = discarded.map((c) => c.card.name).join(", ");
  // The discard was the only thing holding up cleanup: finish the turn.
  return {
    ok: true,
    state: finishCleanup(log({ ...next, awaiting: null }, `${p(playerId)} discarded ${names}.`)),
  };
}

function concede(state: GameState, playerId: string): CommandResult {
  if (state.status === "finished") return fail("The game is already over.");
  const player = findPlayer(state, playerId);
  if (!player) return fail("You're not in this game.");
  return {
    ok: true,
    state: log(
      {
        ...state,
        status: "finished",
        winnerId: opponentOf(state, playerId).id,
        endReason: "concede",
        awaiting: null,
      },
      `${p(playerId)} conceded. ${p(opponentOf(state, playerId).id)} won the game.`
    ),
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
    case "DECLARE_ATTACKERS":
      return declareAttackers(state, command.playerId, command.attackerIds);
    case "DECLARE_BLOCKERS":
      return declareBlockers(state, command.playerId, command.blocks);
    case "CHOOSE_TRIGGER_TARGET":
      return chooseTriggerTarget(state, command.playerId, command.target);
    case "DISCARD":
      return discard(state, command.playerId, command.cardInstanceIds);
    case "CONCEDE":
      return concede(state, command.playerId);
  }
}

/**
 * Moves pending triggers onto the stack. Triggers that don't need a target
 * go straight on. The first one that does needs its controller to choose,
 * so the game pauses there (awaiting = "trigger_target") and the rest wait
 * their turn behind it.
 */
export function putTriggersOnStack(state: GameState): GameState {
  if (state.status !== "in_progress" || state.awaiting !== null) return state;

  let next = state;
  while (next.pendingTriggers.length > 0) {
    const pending = next.pendingTriggers[0];
    if (pending.needsTarget) {
      return {
        ...next,
        awaiting: "trigger_target",
        priorityPlayerId: pending.controllerId,
        consecutivePasses: 0,
      };
    }
    const ability: StackObject = {
      id: randomUUID(),
      controllerId: pending.controllerId,
      source: pending.source,
      kind: "triggered_ability",
      targets: [],
      description: pending.description,
    };
    next = log(
      {
        ...next,
        stack: [...next.stack, ability],
        pendingTriggers: next.pendingTriggers.slice(1),
        priorityPlayerId: next.activePlayerId,
        consecutivePasses: 0,
      },
      `${pending.source.card.name}'s ability triggered.`
    );
  }
  return next;
}

/** The bookkeeping that follows every action: SBA, then pending triggers. */
function settle(state: GameState): GameState {
  return putTriggersOnStack(applyStateBasedActions(state));
}

/**
 * Passes priority on behalf of any player who has nothing they could do,
 * repeatedly, until the game reaches a real choice. This is what makes a
 * turn flow instead of needing a click at every step.
 *
 * Every automatic pass goes through the same passPriority() as a real one,
 * so the rules engine never knows the difference. The loop is bounded so a
 * bug can never spin forever.
 */
/**
 * Test hook. The rules tests walk the game one step at a time and need to
 * observe steps that auto-pass would otherwise skip straight through, so
 * they turn it off. It's always on in the real server.
 */
export let autoPassEnabled = true;
export function setAutoPass(enabled: boolean): void {
  autoPassEnabled = enabled;
}

export function autoAdvance(state: GameState): GameState {
  if (!autoPassEnabled) return state;
  let current = state;
  for (let i = 0; i < 200; i++) {
    if (current.status !== "in_progress" || current.awaiting !== null) return current;
    if (hasSomethingToDo(current)) return current;

    const passed = passPriority(current, current.priorityPlayerId);
    if (!passed.ok) return current;
    current = settle(passed.state);
  }
  return current;
}

export function processCommand(state: GameState, command: GameCommand): CommandResult {
  const result = runCommand(state, command);
  if (!result.ok) return result;

  // Anything other than a plain pass is a deliberate act in this step. It
  // earns the active player a stop here, so they can see what they did
  // (an attack, a spell) and respond before the game moves on.
  const acted = command.type !== "PASS_PRIORITY" && result.state.phase === state.phase;
  const marked = acted ? { ...result.state, actedThisStep: true } : result.state;

  return { ok: true, state: autoAdvance(settle(marked)) };
}