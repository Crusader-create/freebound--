/**
 * autoPass.ts
 *
 * Makes the game feel like Arena: priority still passes back and forth
 * under the hood (that's how Magic works), but nobody is asked to click
 * "pass" when they have nothing they could do.
 *
 * After every command, the engine asks: can the player who holds priority
 * take ANY action right now? If not, the engine passes for them. It keeps
 * doing this until it reaches a player who has a real choice, a decision
 * the game is waiting on (attackers, blockers, a target, a discard), or
 * the end of the game.
 *
 * "Can do something" means one of:
 *   - play a land (own turn, main phase, empty stack, land drop unused,
 *     a land in hand)
 *   - cast a spell they can pay for, at a time they're allowed to
 *   - hold a "useful" instant at a moment worth stopping for (below)
 *
 * An instant is useful only if they can pay for it AND it has a legal
 * target right now (a creature-only spell with no creatures out, or
 * "destroy target attacking creature" outside combat, doesn't count).
 *
 * Like Arena's default stops, holding a useful instant only stops a player
 * when there's a real moment to use it: something on the stack to respond
 * to, or combat once blockers are declared. Upkeep, draw, the
 * opponent's main phases and end steps pass on their own.
 *
 * Optional stop: a player who turns on "End-step stops" is also stopped at
 * their opponent's end step when holding a useful instant (the classic
 * moment to cast one, after the opponent can no longer react at sorcery
 * speed).
 *
 * The active player is always stopped in their own main phases, whether or
 * not they have anything to cast: they end their main phase with a click,
 * like pressing "Next" in Arena. Everything else auto-passes when there is
 * nothing to do. Per-player "stops" (e.g. always stop at my end step) are a
 * stretch feature.
 */

import type { CardInstance, GameState, Player } from "../../../shared/src/types";
import { effectTargetSpec, getSpellEffect, type SpellEffect } from "./effects";
import { parseManaCost, planPayment } from "./mana";
import { getPlayer, replacePlayer } from "./stateHelpers";

/** Could `player` pay for this card with what they have untapped? */
function canAfford(player: Player, card: CardInstance): boolean {
  const cost = parseManaCost(card.card.manaCost);
  if (!cost) return false;
  return planPayment(player.battlefield, cost) !== null;
}

/** Does this effect have at least one legal target on the board right now? */
function hasLegalTarget(state: GameState, effect: SpellEffect): boolean {
  const creatures = state.players.flatMap((pl) =>
    pl.battlefield.filter((c) => c.card.types.includes("Creature"))
  );
  switch (effectTargetSpec(effect)) {
    case "any":
    case "player":
      return true; // players are always there to target
    case "creature":
      return creatures.length > 0;
    case "attacking_or_blocking_creature":
      return creatures.some((c) => c.attacking || c.blockingInstanceId !== undefined);
  }
}

/**
 * The one combat step where holding a trick stops you even with an empty
 * stack: after blocks are declared, like Arena's default stop. (The
 * attacking player also keeps a stop right after declaring attackers,
 * because they just acted.)
 */
const COMBAT_TRICK_STEPS = new Set(["declare_blockers"]);

/** Is this a card the engine knows how to cast at all? */
function isCastable(card: CardInstance): boolean {
  const types = card.card.types;
  if (types.includes("Land")) return false;
  if (types.includes("Creature")) return true;
  if (types.includes("Instant") || types.includes("Sorcery")) {
    return getSpellEffect(card.card) !== null;
  }
  return false;
}

/**
 * True if the player holding priority has at least one legal action
 * available, so the game should stop and wait for them.
 */
export function hasSomethingToDo(state: GameState): boolean {
  if (state.status !== "in_progress" || state.awaiting !== null) return false;

  const player = getPlayer(state, state.priorityPlayerId);
  const isActive = state.activePlayerId === player.id;
  const inMain = state.phase === "main1" || state.phase === "main2";
  const sorcerySpeed = isActive && inMain && state.stack.length === 0;

  // The active player always ends their own main phase by choice, even with
  // nothing to cast. Skipping them along would feel like losing control of
  // their turn; this is the one place a "pass" click is always expected.
  if (sorcerySpeed) return true;

  // A player who just acted in this step (declared attackers, cast a spell)
  // keeps a stop: they get to see the result before the game moves on.
  if (isActive && state.actedThisStep) return true;

  for (const card of player.hand) {
    const types = card.card.types;

    if (types.includes("Land")) {
      if (sorcerySpeed && player.landsPlayedThisTurn < 1) return true;
      continue;
    }

    if (!isCastable(card) || !canAfford(player, card)) continue;

    if (types.includes("Instant")) {
      const effect = getSpellEffect(card.card);
      if (!effect || !hasLegalTarget(state, effect)) continue;
      const inCombat =
        COMBAT_TRICK_STEPS.has(state.phase) &&
        state.players.some((pl) => pl.battlefield.some((c) => c.attacking));
      const endStepStop = state.phase === "end" && !isActive && player.stopAtOpponentEndStep;
      const worthStopping = state.stack.length > 0 || inCombat || endStepStop;
      if (worthStopping) return true;
      continue;
    }
    if (sorcerySpeed) return true; // creatures and sorceries need sorcery speed
  }

  return false;
}

/** Turns a player's "End-step stops" setting on or off. Not a game action: nothing else changes. */
export function setEndStepStop(state: GameState, playerId: string, on: boolean): GameState {
  const player = state.players.find((pl) => pl.id === playerId);
  if (!player || player.stopAtOpponentEndStep === on) return state;
  return replacePlayer(state, { ...player, stopAtOpponentEndStep: on });
}