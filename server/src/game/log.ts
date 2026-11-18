/**
 * log.ts
 *
 * Writing to the game log. Entries are plain sentences written by the
 * engine at the moment something happens. Players are written as
 * "{p:<id>}" so each client can show "You" or "Opponent" from its seat,
 * and "{P:<id>}" for the possessive ("your" / "opponent's").
 *
 * Only public information goes in the log. A card in a hand is never named
 * until it's played or cast.
 */

import type { GameState } from "../../../shared/src/types";

/** Appends one line to the log. Returns a new state. */
export function log(state: GameState, text: string): GameState {
  return { ...state, log: [...state.log, { turn: state.turnNumber, text }] };
}

/** A player, written for later substitution. */
export const p = (playerId: string) => `{p:${playerId}}`;
/** A player's possessive. */
export const P = (playerId: string) => `{P:${playerId}}`;