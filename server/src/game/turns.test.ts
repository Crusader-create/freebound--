import { describe, expect, it } from "vitest";
import type { BattlefieldCard, GameState, Phase } from "../../../shared/src/types";
import { createGame } from "./createGame";
import { processCommand } from "./engine";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";
import { atStep, BEAR, fakeDeck, pass, passUntil, startedGame, unwrap } from "./testHelpers";

// ---------- helpers ----------
// (The shared pass/passUntil helpers answer any pending decision, such as
// "discard down to hand size", with a default, so these tests can walk
// through whole turns without caring about them.)

/** Makes sure the named card is in the player's hand, pulling it from the library. */
function withCardInHand(state: GameState, playerId: string, name: string): GameState {
  const player = getPlayer(state, playerId);
  if (player.hand.some((c) => c.card.name === name)) return state;

  const index = player.library.findIndex((c) => c.card.name === name);
  if (index === -1) throw new Error(`No ${name} left in the library`);

  return replacePlayer(state, {
    ...player,
    hand: [...player.hand, player.library[index]],
    library: player.library.filter((_, i) => i !== index),
  });
}

function handCardId(state: GameState, playerId: string, name: string): string {
  const card = getPlayer(state, playerId).hand.find((c) => c.card.name === name);
  if (!card) throw new Error(`No ${name} in hand`);
  return card.instanceId;
}

function playLandCommand(state: GameState, playerId: string, cardInstanceId: string) {
  return processCommand(state, { type: "PLAY_LAND", playerId, cardInstanceId });
}

// ---------- tests ----------

describe("starting turn 1", () => {
  it("begins in main phase 1 with the first player active and holding priority", () => {
    const state = startedGame();
    expect(state.status).toBe("in_progress");
    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe("main1");
    expect(state.activePlayerId).toBe(state.firstPlayerId);
    expect(state.priorityPlayerId).toBe(state.firstPlayerId);
    expect(state.consecutivePasses).toBe(0);
  });
});

describe("priority", () => {
  it("refuses a pass from the player who doesn't have priority", () => {
    const state = startedGame();
    const other = opponentOf(state, state.priorityPlayerId).id;
    const result = processCommand(state, { type: "PASS_PRIORITY", playerId: other });
    expect(result.ok).toBe(false);
  });

  it("refuses passes before the game has started", () => {
    const state = createGame(
      { id: "p1", name: "Player 1", deck: fakeDeck() },
      { id: "p2", name: "Player 2", deck: fakeDeck() }
    );
    const result = processCommand(state, { type: "PASS_PRIORITY", playerId: "p1" });
    expect(result.ok).toBe(false);
  });

  it("one pass hands priority to the other player without advancing the step", () => {
    const state = startedGame();
    const active = state.activePlayerId;
    const after = pass(state);
    expect(after.phase).toBe("main1");
    expect(after.consecutivePasses).toBe(1);
    expect(after.priorityPlayerId).toBe(opponentOf(state, active).id);
  });

  it("two passes in a row advance the step and return priority to the active player", () => {
    const state = startedGame();
    const after = pass(pass(state));
    expect(after.phase).toBe("beginning_of_combat");
    expect(after.consecutivePasses).toBe(0);
    expect(after.priorityPlayerId).toBe(state.activePlayerId);
  });
});

describe("turn structure", () => {
  it("runs the steps in order, skipping blockers and damage when nobody attacks", () => {
    let state = startedGame();
    const visited: Phase[] = [state.phase];

    while (state.turnNumber === 1) {
      state = pass(state);
      if (visited[visited.length - 1] !== state.phase) visited.push(state.phase);
    }

    expect(visited).toEqual([
      "main1",
      "beginning_of_combat",
      "declare_attackers",
      "end_of_combat",
      "main2",
      "end",
      "main1", // turn 2: untap, upkeep, and draw are automatic, so it lands in main 1
    ]);
  });

  it("passes the turn to the other player and increments the turn number", () => {
    const start = startedGame();
    const turn2 = passUntil(start, (s) => s.turnNumber === 2);
    expect(turn2.activePlayerId).toBe(opponentOf(start, start.activePlayerId).id);
    expect(turn2.priorityPlayerId).toBe(turn2.activePlayerId);
  });

  it("alternates active players across turns", () => {
    const start = startedGame();
    const turn3 = passUntil(start, (s) => s.turnNumber === 3);
    expect(turn3.activePlayerId).toBe(start.activePlayerId);
  });
});

describe("the untap step", () => {
  it("untaps a player's permanents at the start of their turn", () => {
    const start = startedGame();
    const secondPlayerId = opponentOf(start, start.activePlayerId).id;

    // Give the second player a tapped land from their library.
    const second = getPlayer(start, secondPlayerId);
    const land = second.library.find((c) => c.card.name === "Forest");
    if (!land) throw new Error("expected a Forest in the library");
    const tappedLand: BattlefieldCard = {
      ...land,
      controllerId: secondPlayerId,
      tapped: true,
      summoningSick: true,
      damageMarked: 0,
      powerModifier: 0,
      toughnessModifier: 0,
      attacking: false,
    };
    const rigged = replacePlayer(start, {
      ...second,
      library: second.library.filter((c) => c.instanceId !== land.instanceId),
      battlefield: [tappedLand],
    });

    const turn2 = passUntil(rigged, (s) => s.turnNumber === 2);
    const permanent = getPlayer(turn2, secondPlayerId).battlefield[0];
    expect(permanent.tapped).toBe(false);
    expect(permanent.summoningSick).toBe(false);
  });
});

describe("the draw rule", () => {
  it("the player going first skips their first draw", () => {
    const state = passUntil(startedGame(), atStep(1, "main1"));
    const active = getPlayer(state, state.activePlayerId);
    expect(active.hand).toHaveLength(7);
    expect(active.library).toHaveLength(53);
  });

  it("the player on the draw does draw on their first turn", () => {
    const state = passUntil(startedGame(), atStep(2, "main1"));
    const active = getPlayer(state, state.activePlayerId);
    expect(active.hand).toHaveLength(8);
    expect(active.library).toHaveLength(52);
  });

  it("loses the game by drawing from an empty library", () => {
    const start = startedGame();
    const secondId = opponentOf(start, start.activePlayerId).id;
    const rigged = replacePlayer(start, { ...getPlayer(start, secondId), library: [] });

    const finished = passUntil(rigged, (s) => s.status === "finished");
    expect(finished.winnerId).toBe(start.firstPlayerId);
    expect(finished.endReason).toBe("decked");

    const result = processCommand(finished, {
      type: "PASS_PRIORITY",
      playerId: finished.priorityPlayerId,
    });
    expect(result.ok).toBe(false);
  });
});

describe("playing a land", () => {
  it("puts a land from hand onto the battlefield during a main phase", () => {
    let state = passUntil(startedGame(), atStep(1, "main1"));
    const active = state.activePlayerId;
    state = withCardInHand(state, active, "Forest");
    const before = getPlayer(state, active);

    const after = unwrap(playLandCommand(state, active, handCardId(state, active, "Forest")));
    const player = getPlayer(after, active);
    expect(player.hand).toHaveLength(before.hand.length - 1);
    expect(player.battlefield).toHaveLength(1);
    expect(player.battlefield[0].card.name).toBe("Forest");
    expect(player.landsPlayedThisTurn).toBe(1);
  });

  it("refuses a second land in the same turn", () => {
    let state = passUntil(startedGame(), atStep(1, "main1"));
    const active = state.activePlayerId;
    state = withCardInHand(state, active, "Forest");
    state = unwrap(playLandCommand(state, active, handCardId(state, active, "Forest")));
    state = withCardInHand(state, active, "Forest");

    const second = playLandCommand(state, active, handCardId(state, active, "Forest"));
    expect(second.ok).toBe(false);
  });

  it("refuses a land outside a main phase", () => {
    let state = passUntil(startedGame(), atStep(1, "beginning_of_combat"));
    const active = state.activePlayerId;
    state = withCardInHand(state, active, "Forest");
    const result = playLandCommand(state, active, handCardId(state, active, "Forest"));
    expect(result.ok).toBe(false);
  });

  it("refuses a card that isn't a land", () => {
    let state = passUntil(startedGame(), atStep(1, "main1"));
    const active = state.activePlayerId;
    state = withCardInHand(state, active, BEAR.name);
    const result = playLandCommand(state, active, handCardId(state, active, BEAR.name));
    expect(result.ok).toBe(false);
  });

  it("refuses a card that isn't in the player's hand", () => {
    const state = passUntil(startedGame(), atStep(1, "main1"));
    const result = playLandCommand(state, state.activePlayerId, "not-a-real-id");
    expect(result.ok).toBe(false);
  });

  it("refuses a land from the non-active player, even when they hold priority", () => {
    let state = passUntil(startedGame(), atStep(1, "main1"));
    const other = opponentOf(state, state.activePlayerId).id;
    state = pass(state); // active passes, so the other player now has priority
    expect(state.priorityPlayerId).toBe(other);

    state = withCardInHand(state, other, "Forest");
    const result = playLandCommand(state, other, handCardId(state, other, "Forest"));
    expect(result.ok).toBe(false);
  });

  it("resets the land drop on the player's next turn", () => {
    let state = passUntil(startedGame(), atStep(1, "main1"));
    const active = state.activePlayerId;
    state = withCardInHand(state, active, "Forest");
    state = unwrap(playLandCommand(state, active, handCardId(state, active, "Forest")));

    state = passUntil(state, atStep(3, "main1")); // the same player's next turn
    expect(state.activePlayerId).toBe(active);
    expect(getPlayer(state, active).landsPlayedThisTurn).toBe(0);

    state = withCardInHand(state, active, "Forest");
    state = unwrap(playLandCommand(state, active, handCardId(state, active, "Forest")));
    expect(getPlayer(state, active).battlefield).toHaveLength(2);
  });
});