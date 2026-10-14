import { describe, expect, it } from "vitest";
import type { CachedCard, GameState } from "../../../shared/src/types";
import type { ValidatedCard } from "../cards/validateDeck";
import { createGame } from "./createGame";
import { keepHand, MAX_MULLIGANS, takeMulligan, type MulliganResult } from "./mulligan";

// ---------- helpers ----------

function fakeCard(name: string): CachedCard {
  return {
    scryfallId: name,
    name,
    manaCost: "",
    types: ["Land"],
    oracleText: "",
    imageUrl: "",
    standardLegal: true,
  };
}

function fakeDeck(): ValidatedCard[] {
  return [
    { card: fakeCard("Alpha"), count: 30 },
    { card: fakeCard("Beta"), count: 30 },
  ];
}

function newGame(): GameState {
  return createGame(
    { id: "p1", name: "Player 1", deck: fakeDeck() },
    { id: "p2", name: "Player 2", deck: fakeDeck() }
  );
}

/** Unwraps a successful result, failing the test loudly if it was refused. */
function unwrap(result: MulliganResult): GameState {
  if (!result.ok) throw new Error(`Expected success but got: ${result.reason}`);
  return result.state;
}

function playerOf(state: GameState, id: string) {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error(`No player ${id}`);
  return player;
}

// ---------- tests ----------

describe("opening state", () => {
  it("deals 7 cards to each player and starts in the mulligan phase", () => {
    const game = newGame();
    expect(game.status).toBe("mulligan");
    for (const p of game.players) {
      expect(p.hand).toHaveLength(7);
      expect(p.library).toHaveLength(53);
    }
  });
});

describe("takeMulligan", () => {
  it("draws a fresh 7 and counts the mulligan", () => {
    const after = unwrap(takeMulligan(newGame(), "p1"));
    const p1 = playerOf(after, "p1");
    expect(p1.hand).toHaveLength(7);
    expect(p1.library).toHaveLength(53);
    expect(p1.mulligansTaken).toBe(1);
  });

  it("does not change the other player or the original state", () => {
    const before = newGame();
    const p2HandBefore = playerOf(before, "p2").hand.map((c) => c.instanceId);
    const p1HandBefore = playerOf(before, "p1").hand.map((c) => c.instanceId);

    const after = unwrap(takeMulligan(before, "p1"));

    expect(playerOf(after, "p2").hand.map((c) => c.instanceId)).toEqual(p2HandBefore);
    // The original state object must be untouched.
    expect(playerOf(before, "p1").hand.map((c) => c.instanceId)).toEqual(p1HandBefore);
    expect(playerOf(before, "p1").mulligansTaken).toBe(0);
  });

  it("stops allowing mulligans after the maximum", () => {
    let state = newGame();
    for (let i = 0; i < MAX_MULLIGANS; i++) {
      state = unwrap(takeMulligan(state, "p1"));
    }
    const result = takeMulligan(state, "p1");
    expect(result.ok).toBe(false);
  });

  it("refuses unknown players", () => {
    expect(takeMulligan(newGame(), "nobody").ok).toBe(false);
  });
});

describe("keepHand", () => {
  it("keeps a 7-card hand with nothing bottomed when no mulligans were taken", () => {
    const after = unwrap(keepHand(newGame(), "p1"));
    const p1 = playerOf(after, "p1");
    expect(p1.keptHand).toBe(true);
    expect(p1.hand).toHaveLength(7);
    expect(p1.library).toHaveLength(53);
  });

  it("after two mulligans, keeps 5 cards and bottoms 2", () => {
    let state = newGame();
    state = unwrap(takeMulligan(state, "p1"));
    state = unwrap(takeMulligan(state, "p1"));

    const handBeforeKeep = playerOf(state, "p1").hand.map((c) => c.instanceId);
    state = unwrap(keepHand(state, "p1"));
    const p1 = playerOf(state, "p1");

    expect(p1.hand).toHaveLength(5);
    expect(p1.library).toHaveLength(55);

    // The 2 bottomed cards sit at the END of the library, and together with
    // the kept cards they make up exactly the hand that was held before.
    const bottomed = p1.library.slice(-2).map((c) => c.instanceId);
    const kept = p1.hand.map((c) => c.instanceId);
    expect(new Set([...bottomed, ...kept])).toEqual(new Set(handBeforeKeep));
  });

  it("never loses or duplicates a card", () => {
    let state = newGame();
    state = unwrap(takeMulligan(state, "p1"));
    state = unwrap(takeMulligan(state, "p1"));
    state = unwrap(takeMulligan(state, "p1"));
    state = unwrap(keepHand(state, "p1"));

    const p1 = playerOf(state, "p1");
    const ids = [...p1.hand, ...p1.library].map((c) => c.instanceId);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });

  it("cannot mulligan or keep again after keeping", () => {
    const state = unwrap(keepHand(newGame(), "p1"));
    expect(takeMulligan(state, "p1").ok).toBe(false);
    expect(keepHand(state, "p1").ok).toBe(false);
  });
});

describe("starting the game", () => {
  it("stays in the mulligan phase until BOTH players keep", () => {
    const state = unwrap(keepHand(newGame(), "p1"));
    expect(state.status).toBe("mulligan");
  });

  it("moves to in_progress once both players have kept", () => {
    let state = unwrap(keepHand(newGame(), "p1"));
    state = unwrap(keepHand(state, "p2"));
    expect(state.status).toBe("in_progress");
  });

  it("refuses mulligan decisions once the game has started", () => {
    let state = unwrap(keepHand(newGame(), "p1"));
    state = unwrap(keepHand(state, "p2"));
    expect(takeMulligan(state, "p1").ok).toBe(false);
  });
});