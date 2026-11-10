import { describe, expect, it } from "vitest";
import type { GameState } from "../../../shared/src/types";
import { processCommand } from "./engine";
import { getPlayer, opponentOf } from "./stateHelpers";
import {
  addPermanent,
  addToHand,
  atStep,
  BEAR,
  ELF,
  FOREST,
  MOUNTAIN,
  pass,
  passUntil,
  SHOCK,
  startedGame,
  unwrap,
} from "./testHelpers";

// ---------- helpers ----------

/** Turn 1, main phase 1. The active player holds priority. */
function mainPhase(): GameState {
  return passUntil(startedGame(), atStep(1, "main1"));
}

function cast(state: GameState, playerId: string, cardInstanceId: string) {
  return processCommand(state, { type: "CAST_SPELL", playerId, cardInstanceId });
}

/** Active player with two untapped Forests and a Bear in hand. */
function readyToCastBear() {
  let state = mainPhase();
  const me = state.activePlayerId;
  state = addPermanent(state, me, FOREST).state;
  state = addPermanent(state, me, FOREST).state;
  const hand = addToHand(state, me, BEAR);
  return { state: hand.state, me, bearId: hand.instanceId };
}

// ---------- tests ----------

describe("casting a creature", () => {
  it("puts it on the stack, taps the lands, and the caster keeps priority", () => {
    const { state, me, bearId } = readyToCastBear();
    const after = unwrap(cast(state, me, bearId));

    expect(after.stack).toHaveLength(1);
    expect(after.stack[0].source.card.name).toBe(BEAR.name);
    expect(after.stack[0].controllerId).toBe(me);

    const player = getPlayer(after, me);
    expect(player.hand.some((c) => c.instanceId === bearId)).toBe(false);
    expect(player.battlefield.every((p) => p.tapped)).toBe(true);

    expect(after.priorityPlayerId).toBe(me);
    expect(after.consecutivePasses).toBe(0);
  });

  it("enters the battlefield only after both players pass", () => {
    const { state, me, bearId } = readyToCastBear();
    let game = unwrap(cast(state, me, bearId));

    game = pass(game); // caster passes
    expect(game.stack).toHaveLength(1);
    expect(game.priorityPlayerId).toBe(opponentOf(game, me).id);

    game = pass(game); // opponent passes: the spell resolves
    expect(game.stack).toHaveLength(0);

    const bear = getPlayer(game, me).battlefield.find((p) => p.card.name === BEAR.name);
    expect(bear).toBeDefined();
    expect(bear?.card.power).toBe(2);
    expect(bear?.card.toughness).toBe(2);
    expect(bear?.summoningSick).toBe(true);

    // Resolving doesn't end the step; the active player gets priority again.
    expect(game.phase).toBe("main1");
    expect(game.priorityPlayerId).toBe(me);
  });

  it("is no longer summoning sick on its controller's next turn", () => {
    const { state, me, bearId } = readyToCastBear();
    let game = unwrap(cast(state, me, bearId));
    game = pass(pass(game));

    game = passUntil(game, atStep(3, "main1")); // the same player's next turn
    const bear = getPlayer(game, me).battlefield.find((p) => p.card.name === BEAR.name);
    expect(bear?.summoningSick).toBe(false);
  });
});

describe("paying for spells", () => {
  it("refuses a spell the player can't afford", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state; // only 1 land; Bear costs 2
    const hand = addToHand(state, me, BEAR);

    const result = cast(hand.state, me, hand.instanceId);
    expect(result.ok).toBe(false);
    // The refused cast changed nothing.
    expect(getPlayer(hand.state, me).hand.some((c) => c.instanceId === hand.instanceId)).toBe(true);
    expect(getPlayer(hand.state, me).battlefield[0].tapped).toBe(false);
  });

  it("refuses when the right color is missing", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, MOUNTAIN).state;
    state = addPermanent(state, me, MOUNTAIN).state; // 2 mana, but no green
    const hand = addToHand(state, me, BEAR);

    expect(cast(hand.state, me, hand.instanceId).ok).toBe(false);
  });

  it("can't use a summoning-sick mana creature to pay", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state;
    state = addPermanent(state, me, ELF, { summoningSick: true }).state;
    const hand = addToHand(state, me, BEAR);

    expect(cast(hand.state, me, hand.instanceId).ok).toBe(false);
  });

  it("can use a mana creature that's been around since the start of the turn", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state;
    state = addPermanent(state, me, ELF, { summoningSick: false }).state;
    const hand = addToHand(state, me, BEAR);

    const after = unwrap(cast(hand.state, me, hand.instanceId));
    expect(getPlayer(after, me).battlefield.every((p) => p.tapped)).toBe(true);
  });

  it("taps lands before mana creatures", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state;
    state = addPermanent(state, me, FOREST).state;
    const elf = addPermanent(state, me, ELF, { summoningSick: false });
    const hand = addToHand(elf.state, me, BEAR);

    const after = unwrap(cast(hand.state, me, hand.instanceId));
    const elfAfter = getPlayer(after, me).battlefield.find((p) => p.instanceId === elf.instanceId);
    expect(elfAfter?.tapped).toBe(false);
  });
});

describe("refusing illegal casts", () => {
  it("refuses outside a main phase", () => {
    let state = passUntil(startedGame(), atStep(1, "beginning_of_combat"));
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state;
    state = addPermanent(state, me, FOREST).state;
    const hand = addToHand(state, me, BEAR);

    expect(cast(hand.state, me, hand.instanceId).ok).toBe(false);
  });

  it("refuses on the opponent's turn, even when holding priority", () => {
    let state = mainPhase();
    const other = opponentOf(state, state.activePlayerId).id;
    state = pass(state); // active passes; the other player now has priority
    expect(state.priorityPlayerId).toBe(other);

    state = addPermanent(state, other, FOREST).state;
    state = addPermanent(state, other, FOREST).state;
    const hand = addToHand(state, other, BEAR);

    expect(cast(hand.state, other, hand.instanceId).ok).toBe(false);
  });

  it("refuses when a player doesn't have priority", () => {
    const { state, me, bearId } = readyToCastBear();
    const afterCast = unwrap(cast(state, me, bearId));
    const passed = pass(afterCast); // priority moves to the opponent
    expect(cast(passed, me, bearId).ok).toBe(false);
  });

  it("refuses a creature while something is already on the stack", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    for (let i = 0; i < 4; i++) state = addPermanent(state, me, FOREST).state;
    const first = addToHand(state, me, BEAR);
    const second = addToHand(first.state, me, BEAR);

    const afterFirst = unwrap(cast(second.state, me, first.instanceId));
    expect(cast(afterFirst, me, second.instanceId).ok).toBe(false);
  });

  it("refuses a card that isn't in hand", () => {
    const { state, me } = readyToCastBear();
    expect(cast(state, me, "not-a-real-id").ok).toBe(false);
  });

  it("refuses to cast a land", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const hand = addToHand(state, me, FOREST);
    expect(cast(hand.state, me, hand.instanceId).ok).toBe(false);
  });

  it("refuses instants and sorceries until spell effects exist", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, MOUNTAIN).state;
    const hand = addToHand(state, me, SHOCK);
    expect(cast(hand.state, me, hand.instanceId).ok).toBe(false);
  });
});