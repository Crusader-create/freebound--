/**
 * testHelpers.ts
 *
 * Fixtures and helpers shared by the engine tests. Not a test file itself.
 * Cards here are fakes with just enough data for the rules being tested.
 */

import { randomUUID } from "crypto";
import type {
  BattlefieldCard,
  CachedCard,
  CardInstance,
  GameState,
  Phase,
} from "../../../shared/src/types";
import type { ValidatedCard } from "../cards/validateDeck";
import { createGame } from "./createGame";
import { processCommand } from "./engine";
import { keepHand } from "./mulligan";
import { getPlayer, replacePlayer } from "./stateHelpers";

// ---------- fake cards ----------

export function fakeCard(
  name: string,
  types: string[],
  extra: Partial<CachedCard> = {}
): CachedCard {
  return {
    scryfallId: name,
    name,
    manaCost: "",
    types,
    oracleText: "",
    imageUrl: "",
    standardLegal: true,
    ...extra,
  };
}

export const FOREST = fakeCard("Forest", ["Basic", "Land"], {
  oracleText: "({T}: Add {G}.)",
});
export const MOUNTAIN = fakeCard("Mountain", ["Basic", "Land"], {
  oracleText: "({T}: Add {R}.)",
});
/** A 2/2 for {1}{G}. */
export const BEAR = fakeCard("Test Bear", ["Creature"], {
  manaCost: "{1}{G}",
  power: 2,
  toughness: 2,
});
/** A 1/1 for {G} that taps for {G}. */
export const ELF = fakeCard("Test Elf", ["Creature"], {
  manaCost: "{G}",
  power: 1,
  toughness: 1,
  oracleText: "{T}: Add {G}.",
});
export const SHOCK = fakeCard("Test Shock", ["Instant"], {
  manaCost: "{R}",
  oracleText: "Test Shock deals 2 damage to any target.",
});

/** 24 Forests and 36 Bears: 60 cards. */
export function fakeDeck(): ValidatedCard[] {
  return [
    { card: FOREST, count: 24 },
    { card: BEAR, count: 36 },
  ];
}

// ---------- results ----------

export type AnyResult = { ok: true; state: GameState } | { ok: false; reason: string };

export function unwrap(result: AnyResult): GameState {
  if (!result.ok) throw new Error(`Expected success but got: ${result.reason}`);
  return result.state;
}

// ---------- starting and moving a game ----------

/** Both players have kept: turn 1, main phase 1, first player active. */
export function startedGame(): GameState {
  let state = createGame(
    { id: "p1", name: "Player 1", deck: fakeDeck() },
    { id: "p2", name: "Player 2", deck: fakeDeck() }
  );
  state = unwrap(keepHand(state, "p1"));
  state = unwrap(keepHand(state, "p2"));
  return state;
}

/** Whoever currently holds priority passes. */
export function pass(state: GameState): GameState {
  return unwrap(
    processCommand(state, { type: "PASS_PRIORITY", playerId: state.priorityPlayerId })
  );
}

export function passUntil(state: GameState, done: (s: GameState) => boolean): GameState {
  let current = state;
  for (let i = 0; i < 300; i++) {
    if (done(current)) return current;
    current = pass(current);
  }
  throw new Error("passUntil never reached the target state");
}

export function atStep(turn: number, phase: Phase) {
  return (s: GameState) => s.turnNumber === turn && s.phase === phase;
}

// ---------- rigging a state ----------

/** Adds a brand-new copy of `card` to a player's hand. */
export function addToHand(
  state: GameState,
  playerId: string,
  card: CachedCard
): { state: GameState; instanceId: string } {
  const instance: CardInstance = { instanceId: randomUUID(), card, ownerId: playerId };
  const player = getPlayer(state, playerId);
  return {
    state: replacePlayer(state, { ...player, hand: [...player.hand, instance] }),
    instanceId: instance.instanceId,
  };
}

export function makePermanent(
  playerId: string,
  card: CachedCard,
  overrides: Partial<BattlefieldCard> = {}
): BattlefieldCard {
  return {
    instanceId: randomUUID(),
    card,
    ownerId: playerId,
    controllerId: playerId,
    tapped: false,
    summoningSick: false,
    damageMarked: 0,
    attacking: false,
    ...overrides,
  };
}

/** Adds a brand-new permanent to a player's battlefield. */
export function addPermanent(
  state: GameState,
  playerId: string,
  card: CachedCard,
  overrides: Partial<BattlefieldCard> = {}
): { state: GameState; instanceId: string } {
  const permanent = makePermanent(playerId, card, overrides);
  const player = getPlayer(state, playerId);
  return {
    state: replacePlayer(state, {
      ...player,
      battlefield: [...player.battlefield, permanent],
    }),
    instanceId: permanent.instanceId,
  };
}