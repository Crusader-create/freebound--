/**
 * sba.ts
 *
 * State-based actions: the rules the game checks automatically, without
 * anyone choosing to do anything.
 *
 *   - A player with 0 or less life loses.
 *   - A creature with 0 or less toughness, or with damage at least equal to
 *     its toughness, dies (goes to its owner's graveyard).
 *
 * They're checked repeatedly until nothing changes, since one death can
 * cause another. The engine runs this after every successful command.
 *
 * "When this dies" triggers will hook in here in Week 6: this is the place
 * that will record the deaths as events.
 */

import type { GameState } from "../../../shared/src/types";
import { destroyPermanent, effectiveToughness } from "./permanents";
import { opponentOf } from "./stateHelpers";

function applyOnce(state: GameState): GameState {
  if (state.status !== "in_progress") return state;

  // Players at 0 or less life lose. If both do at once, nobody wins.
  const losers = state.players.filter((p) => p.life <= 0);
  if (losers.length > 0) {
    return {
      ...state,
      status: "finished",
      winnerId: losers.length === 1 ? opponentOf(state, losers[0].id).id : null,
      endReason: "life",
    };
  }

  // Creatures with lethal damage, or no toughness left, die.
  let result = state;
  let changed = false;
  for (const player of state.players) {
    for (const permanent of player.battlefield) {
      if (!permanent.card.types.includes("Creature")) continue;
      const toughness = effectiveToughness(permanent);
      if (toughness <= 0 || permanent.damageMarked >= toughness) {
        result = destroyPermanent(result, permanent.instanceId);
        changed = true;
      }
    }
  }
  return changed ? result : state;
}

export function applyStateBasedActions(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 100; i++) {
    const next = applyOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}