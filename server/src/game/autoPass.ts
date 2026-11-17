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
 *   - the stack is non-empty and they hold an instant they can pay for
 *     (so they could respond)
 *
 * The active player is always stopped in their own main phases, whether or
 * not they have anything to cast: they end their main phase with a click,
 * like pressing "Next" in Arena. Everything else auto-passes when there is
 * nothing to do. Per-player "stops" (e.g. always stop at my end step) are a
 * stretch feature.
 */

import type { CardInstance, GameState, Player } from "../../../shared/src/types";
import { getSpellEffect } from "./effects";
import { parseManaCost, planPayment } from "./mana";
import { getPlayer } from "./stateHelpers";

/** Could `player` pay for this card with what they have untapped? */
function canAfford(player: Player, card: CardInstance): boolean {
  const cost = parseManaCost(card.card.manaCost);
  if (!cost) return false;
  return planPayment(player.battlefield, cost) !== null;
}

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

    if (types.includes("Instant")) return true; // instants work any time you have priority
    if (sorcerySpeed) return true; // creatures and sorceries need sorcery speed
  }

  return false;
}