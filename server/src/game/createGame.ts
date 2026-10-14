/**
 * createGame.ts
 *
 * Turns two validated decks into a fresh GameState: every card becomes a
 * uniquely-identified CardInstance, each library is shuffled, each player
 * draws an opening hand of 7, and a coin flip picks who goes first.
 *
 * The game starts in the "mulligan" status. The mulligan decisions
 * themselves come next week; for now players just have their first 7 cards.
 *
 * Also contains toView(), which produces the filtered version of the state
 * that a given player is allowed to see (own hand yes, opponent's hand no).
 */

import { randomUUID } from "crypto";
import type {
  CardInstance,
  GameState,
  GameStateView,
  ManaPool,
  Player,
  PlayerView,
} from "../../../shared/src/types";
import type { ValidatedCard } from "../cards/validateDeck";

export const STARTING_LIFE = 20;
export const OPENING_HAND_SIZE = 7;

export type PlayerSeat = {
  id: string;
  name: string;
  deck: ValidatedCard[];
};

/** Fisher-Yates shuffle. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

/** One CardInstance per physical copy, each with its own instanceId. */
function buildLibrary(ownerId: string, deck: ValidatedCard[]): CardInstance[] {
  const instances: CardInstance[] = [];
  for (const { card, count } of deck) {
    for (let i = 0; i < count; i++) {
      instances.push({ instanceId: randomUUID(), card, ownerId });
    }
  }
  return instances;
}

function createPlayer(seat: PlayerSeat): Player {
  const shuffled = shuffle(buildLibrary(seat.id, seat.deck));
  return {
    id: seat.id,
    name: seat.name,
    life: STARTING_LIFE,
    hand: shuffled.slice(0, OPENING_HAND_SIZE),
    library: shuffled.slice(OPENING_HAND_SIZE),
    battlefield: [],
    graveyard: [],
    exile: [],
    manaPool: emptyManaPool(),
    mulligansTaken: 0,
    keptHand: false,
    landsPlayedThisTurn: 0,
  };
}

export function createGame(seatA: PlayerSeat, seatB: PlayerSeat): GameState {
  const players: [Player, Player] = [createPlayer(seatA), createPlayer(seatB)];
  const firstPlayerId = players[Math.random() < 0.5 ? 0 : 1].id; // coin flip

  return {
    gameId: randomUUID(),
    status: "mulligan",
    players,
    firstPlayerId,
    activePlayerId: firstPlayerId,
    priorityPlayerId: firstPlayerId,
    consecutivePasses: 0,
    turnNumber: 1,
    phase: "untap",
    stack: [],
    winnerId: null,
    endReason: null,
  };
}

function toPlayerView(player: Player, includeHand: boolean): PlayerView {
  const { library, hand, ...publicFields } = player;
  return {
    ...publicFields,
    handCount: hand.length,
    libraryCount: library.length,
    ...(includeHand ? { hand } : {}),
  };
}

/** The version of the game a specific player is allowed to see. */
export function toView(state: GameState, viewerId: string): GameStateView {
  const [first, second] = state.players;
  const you = first.id === viewerId ? first : second;
  const opponent = you === first ? second : first;

  const { players: _players, ...sharedFields } = state;
  return {
    ...sharedFields,
    you: toPlayerView(you, true),
    opponent: toPlayerView(opponent, false),
  };
}