/**
 * stateHelpers.ts
 *
 * Tiny helpers for looking up and replacing players in a GameState.
 * Everything returns new objects; nothing mutates the state passed in.
 */

import type { GameState, Player } from "../../../shared/src/types";

export function findPlayer(state: GameState, playerId: string): Player | undefined {
  return state.players.find((p) => p.id === playerId);
}

/** Like findPlayer, but throws. Use only when the id is known to be valid. */
export function getPlayer(state: GameState, playerId: string): Player {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new Error(`No player ${playerId} in game ${state.gameId}`);
  }
  return player;
}

export function opponentOf(state: GameState, playerId: string): Player {
  const [first, second] = state.players;
  return first.id === playerId ? second : first;
}

export function replacePlayer(state: GameState, updated: Player): GameState {
  const players = state.players.map((p) =>
    p.id === updated.id ? updated : p
  ) as [Player, Player];
  return { ...state, players };
}