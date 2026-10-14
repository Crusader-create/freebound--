/**
 * mulligan.ts
 *
 * London mulligan rules, written as pure functions: each takes the current
 * GameState and returns either a NEW state or a reason it was refused. The
 * original state is never modified, so a rejected action can't leave the
 * game half-changed.
 *
 * London mulligan:
 *   - Mulligan = shuffle your hand into your library and draw a fresh 7.
 *   - When you finally keep, you put N cards from your hand on the BOTTOM
 *     of your library, where N is how many times you mulliganed.
 *
 * Simplification for v1: the N cards to bottom are chosen at random instead
 * of by the player. Letting the player choose is a stretch item.
 *
 * Library convention used everywhere: library[0] is the TOP of the library,
 * and the last element is the bottom.
 */

import type { GameState, Player } from "../../../shared/src/types";
import { OPENING_HAND_SIZE, shuffle } from "./createGame";

/** Mulliganing past this would leave a 0-card hand, so we stop here. */
export const MAX_MULLIGANS = 6;

export type MulliganResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

function fail(reason: string): MulliganResult {
  return { ok: false, reason };
}

function replacePlayer(state: GameState, updated: Player): GameState {
  const players = state.players.map((p) =>
    p.id === updated.id ? updated : p
  ) as [Player, Player];
  return { ...state, players };
}

/** Finds the deciding player, or explains why they can't decide right now. */
function findDecidingPlayer(
  state: GameState,
  playerId: string
): { player: Player } | { reason: string } {
  if (state.status !== "mulligan") {
    return { reason: "The mulligan phase is over." };
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { reason: "You're not in this game." };
  if (player.keptHand) return { reason: "You've already kept your hand." };
  return { player };
}

export function takeMulligan(state: GameState, playerId: string): MulliganResult {
  const found = findDecidingPlayer(state, playerId);
  if ("reason" in found) return fail(found.reason);
  const { player } = found;

  if (player.mulligansTaken >= MAX_MULLIGANS) {
    return fail("You can't mulligan any further.");
  }

  const reshuffled = shuffle([...player.hand, ...player.library]);
  return {
    ok: true,
    state: replacePlayer(state, {
      ...player,
      hand: reshuffled.slice(0, OPENING_HAND_SIZE),
      library: reshuffled.slice(OPENING_HAND_SIZE),
      mulligansTaken: player.mulligansTaken + 1,
    }),
  };
}

export function keepHand(state: GameState, playerId: string): MulliganResult {
  const found = findDecidingPlayer(state, playerId);
  if ("reason" in found) return fail(found.reason);
  const { player } = found;

  // Randomly pick N cards from the hand to go on the bottom of the library.
  const shuffledHand = shuffle(player.hand);
  const bottomed = shuffledHand.slice(0, player.mulligansTaken);
  const kept = shuffledHand.slice(player.mulligansTaken);

  let next = replacePlayer(state, {
    ...player,
    hand: kept,
    library: [...player.library, ...bottomed],
    keptHand: true,
  });

  // Once both players have kept, the game itself begins.
  if (next.players.every((p) => p.keptHand)) {
    next = { ...next, status: "in_progress" };
  }

  return { ok: true, state: next };
}