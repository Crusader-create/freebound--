/**
 * autoPass.test.ts
 *
 * The "feel" of a turn with auto-pass on. These are the only tests that run
 * with auto-pass enabled; every other test file turns it off (via
 * testHelpers) so it can observe intermediate steps.
 *
 * The rules being pinned down:
 *   - a turn with nothing to respond to needs 3 clicks (land, end main 1,
 *     end main 2) and the opponent is never prompted
 *   - the active player is never skipped out of their own main phase
 *   - a player who acts keeps priority so they can act again
 *   - an opponent holding a castable instant IS stopped to respond
 *   - an opponent with nothing castable is NOT stopped
 *   - after declaring attackers, the game stops before damage
 *   - holding an instant only stops you when it has a legal target and
 *     there's a moment to use it (a spell to answer, or combat)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import type { CachedCard, GameState } from "../../../shared/src/types";
import { createGame } from "./createGame";
import { setEndStepStop } from "./autoPass";
import { autoAdvance, processCommand, setAutoPass } from "./engine";
import { keepHand } from "./mulligan";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";
import {
  addPermanent,
  BEAR,
  fakeCard,
  fakeCreature,
  FOREST,
  MOUNTAIN,
  SHOCK,
  unwrap,
} from "./testHelpers";

beforeAll(() => setAutoPass(true));
afterAll(() => setAutoPass(false));

// ---------- helpers ----------

function deckOf(cards: [CachedCard, number][]) {
  return cards.map(([card, count]) => ({ card, count }));
}

/** A started game with auto-pass applied, so it sits at the first real choice. */
function started(): GameState {
  let g = createGame(
    { id: "p1", name: "P1", deck: deckOf([[FOREST, 30], [BEAR, 30]]) },
    { id: "p2", name: "P2", deck: deckOf([[FOREST, 30], [BEAR, 30]]) }
  );
  g = unwrap(keepHand(g, "p1"));
  return autoAdvance(unwrap(keepHand(g, "p2")));
}

/** Replaces a player's hand with exactly these cards. */
function setHand(state: GameState, playerId: string, cards: CachedCard[]): GameState {
  const p = getPlayer(state, playerId);
  return replacePlayer(state, {
    ...p,
    hand: cards.map((card) => ({ instanceId: randomUUID(), card, ownerId: playerId })),
  });
}

function pass(state: GameState, playerId: string): GameState {
  return unwrap(processCommand(state, { type: "PASS_PRIORITY", playerId }));
}

function handCard(state: GameState, playerId: string, name: string) {
  const card = getPlayer(state, playerId).hand.find((c) => c.card.name === name);
  if (!card) throw new Error(`no ${name} in hand`);
  return card;
}

// ---------- tests ----------

describe("a quiet turn", () => {
  it("starts in main phase 1 with the active player holding priority", () => {
    const g = started();
    expect(g.phase).toBe("main1");
    expect(g.priorityPlayerId).toBe(g.activePlayerId);
  });

  it("takes three clicks and never prompts the opponent", () => {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    g = setHand(g, me, [FOREST, FOREST, BEAR]);
    g = setHand(g, opp, [FOREST, BEAR]); // nothing castable at instant speed

    // click 1: play a land. Still my main phase, still my priority.
    const land = handCard(g, me, FOREST.name);
    g = unwrap(processCommand(g, { type: "PLAY_LAND", playerId: me, cardInstanceId: land.instanceId }));
    expect(g.phase).toBe("main1");
    expect(g.priorityPlayerId).toBe(me);

    // click 2: end main 1. Combat is empty, so it flows straight to main 2.
    g = pass(g, me);
    expect(g.phase).toBe("main2");
    expect(g.priorityPlayerId).toBe(me);
    expect(g.turnNumber).toBe(1);

    // click 3: end main 2. End step and cleanup are automatic; it's now the
    // opponent's turn and they hold priority in THEIR main phase.
    g = pass(g, me);
    expect(g.turnNumber).toBe(2);
    expect(g.activePlayerId).toBe(opp);
    expect(g.phase).toBe("main1");
    expect(g.priorityPlayerId).toBe(opp);
  });

  it("never skips the active player out of their own main phase, even with an empty hand", () => {
    let g = started();
    const me = g.activePlayerId;
    g = setHand(g, me, []);
    // Re-settle: with nothing in hand the engine must STILL stop in main1.
    g = autoAdvance(g);
    expect(g.phase).toBe("main1");
    expect(g.priorityPlayerId).toBe(me);
  });
});

describe("responding", () => {
  /** The active player has two lands and a Bear in hand; the opponent holds the given cards with one Mountain. */
  function setupCast(oppHand: CachedCard[]) {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    g = addPermanent(g, me, FOREST).state;
    g = addPermanent(g, me, FOREST).state;
    g = addPermanent(g, opp, MOUNTAIN).state;
    g = setHand(g, me, [BEAR]);
    g = setHand(g, opp, oppHand);
    return { g, me, opp };
  }

  it("the caster keeps priority after casting, so they can cast again", () => {
    let { g, me } = setupCast([]);
    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    expect(g.stack).toHaveLength(1);
    expect(g.priorityPlayerId).toBe(me);
  });

  it("an opponent holding a castable instant is stopped to respond", () => {
    let { g, me, opp } = setupCast([SHOCK]);
    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    g = pass(g, me); // I'm done; now the opponent gets their window

    expect(g.stack).toHaveLength(1); // the Bear has NOT resolved yet
    expect(g.priorityPlayerId).toBe(opp);

    g = pass(g, opp); // they decline
    expect(g.stack).toHaveLength(0); // now it resolves
    expect(getPlayer(g, me).battlefield.some((c) => c.card.name === BEAR.name)).toBe(true);
    expect(g.priorityPlayerId).toBe(me); // and I'm back in my main phase
    expect(g.phase).toBe("main1");
  });

  it("an opponent with nothing castable is NOT stopped; the spell just resolves", () => {
    let { g, me } = setupCast([BEAR]); // a creature can't be cast at instant speed
    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    g = pass(g, me);

    expect(g.stack).toHaveLength(0); // resolved with no opponent prompt
    expect(g.priorityPlayerId).toBe(me);
    expect(getPlayer(g, me).battlefield.some((c) => c.card.name === BEAR.name)).toBe(true);
  });

  it("an opponent who can't afford their instant is not stopped either", () => {
    let { g, me, opp } = setupCast([SHOCK]);
    // Tap their only Mountain so Shock is unaffordable.
    const theirs = getPlayer(g, opp);
    g = replacePlayer(g, { ...theirs, battlefield: theirs.battlefield.map((p) => ({ ...p, tapped: true })) });

    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    g = pass(g, me);
    expect(g.stack).toHaveLength(0);
    expect(g.priorityPlayerId).toBe(me);
  });
});

describe("combat with auto-pass", () => {
  it("stops after declaring attackers, before any damage is dealt", () => {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    const bear = addPermanent(g, me, fakeCreature("Bear", 2, 2));
    g = setHand(bear.state, me, []);
    g = setHand(g, opp, []);

    g = pass(g, me); // end main 1 -> the game asks for attackers
    expect(g.phase).toBe("declare_attackers");
    expect(g.awaiting).toBe("attackers");

    g = unwrap(processCommand(g, { type: "DECLARE_ATTACKERS", playerId: me, attackerIds: [bear.instanceId] }));
    // Stopped here: attack is declared, nobody has been damaged yet.
    expect(g.phase).toBe("declare_attackers");
    expect(g.priorityPlayerId).toBe(me);
    expect(getPlayer(g, opp).life).toBe(20);

    g = pass(g, me); // I'm done; no blockers possible, damage happens, flows to main 2
    expect(getPlayer(g, opp).life).toBe(18);
    expect(g.phase).toBe("main2");
    expect(g.priorityPlayerId).toBe(me);
  });

  it("skips combat entirely when the active player has nothing that can attack", () => {
    let g = started();
    const me = g.activePlayerId;
    g = setHand(g, me, []);
    g = pass(g, me); // end main 1
    expect(g.phase).toBe("main2"); // no attackers prompt, no stop in combat
  });

  it("asks the defender to block when they can, then stops the attacker again before damage", () => {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    const attacker = addPermanent(g, me, fakeCreature("Attacker", 2, 2));
    const blocker = addPermanent(attacker.state, opp, fakeCreature("Blocker", 1, 1));
    g = setHand(blocker.state, me, []);
    g = setHand(g, opp, []);

    g = pass(g, me);
    g = unwrap(processCommand(g, { type: "DECLARE_ATTACKERS", playerId: me, attackerIds: [attacker.instanceId] }));
    g = pass(g, me); // I'm done; now the defender is asked to block
    expect(g.phase).toBe("declare_blockers");
    expect(g.awaiting).toBe("blockers");
    expect(g.priorityPlayerId).toBe(opp);

    g = unwrap(processCommand(g, {
      type: "DECLARE_BLOCKERS",
      playerId: opp,
      blocks: [{ blockerId: blocker.instanceId, attackerId: attacker.instanceId }],
    }));
    // Blocks are in. Priority returns to the attacker, who gets a stop
    // here: this is the window to pump a now-blocked creature. No damage yet.
    expect(g.phase).toBe("declare_blockers");
    expect(g.priorityPlayerId).toBe(me);
    expect(getPlayer(g, opp).battlefield.some((c) => c.card.name === "Blocker")).toBe(true);

    g = pass(g, me); // the attacker is done; damage is dealt and combat ends
    const blockerAlive = getPlayer(g, opp).battlefield.some((c) => c.card.name === "Blocker");
    expect(blockerAlive).toBe(false); // the 1/1 blocked a 2/2
    expect(getPlayer(g, opp).life).toBe(20); // the attacker was blocked, so no player damage
    expect(g.phase).toBe("main2");
  });
});

describe("instants only stop you when they're useful", () => {
  const BURN_CREATURE = fakeCard("Test Creature Burn", ["Instant"], {
    manaCost: "{R}",
    oracleText: "Test Creature Burn deals 3 damage to target creature.",
  });
  const RED_STRIKE = fakeCard("Test Red Strike", ["Instant"], {
    manaCost: "{R}",
    oracleText: "Destroy target attacking or blocking creature.",
  });

  function withOpenMana(oppHand: CachedCard[]) {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    g = addPermanent(g, me, FOREST).state;
    g = addPermanent(g, me, FOREST).state;
    g = addPermanent(g, opp, MOUNTAIN).state;
    g = setHand(g, me, [FOREST, BEAR]);
    g = setHand(g, opp, oppHand);
    return { g, me, opp };
  }

  it("holding Shock with open mana doesn't add clicks to a quiet turn", () => {
    let { g, me, opp } = withOpenMana([SHOCK]);

    const land = handCard(g, me, FOREST.name);
    g = unwrap(processCommand(g, { type: "PLAY_LAND", playerId: me, cardInstanceId: land.instanceId }));
    g = pass(g, me); // end main 1: straight to main 2, no stop for the opponent
    expect(g.phase).toBe("main2");
    expect(g.priorityPlayerId).toBe(me);

    g = pass(g, me); // end main 2: my end step passes without asking them
    expect(g.turnNumber).toBe(2);
    expect(g.activePlayerId).toBe(opp);
    expect(g.phase).toBe("main1"); // their upkeep and draw weren't stops either
  });

  it("a creature-only spell with no creatures out doesn't stop the opponent", () => {
    let { g, me } = withOpenMana([BURN_CREATURE]);
    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    g = pass(g, me);
    expect(g.stack).toHaveLength(0); // the Bear resolved without asking them
    expect(g.priorityPlayerId).toBe(me);
  });

  it("'destroy target attacking creature' doesn't stop anyone outside combat", () => {
    let { g, me } = withOpenMana([RED_STRIKE]);
    g = addPermanent(g, me, fakeCreature("Bystander", 2, 2)).state; // a creature, but not attacking
    const bear = handCard(g, me, BEAR.name);
    g = unwrap(processCommand(g, { type: "CAST_SPELL", playerId: me, cardInstanceId: bear.instanceId }));
    g = pass(g, me);
    expect(g.stack).toHaveLength(0);
    expect(g.priorityPlayerId).toBe(me);
  });

  it("the defender holding a trick gets one stop in combat, after blocks", () => {
    let { g, me, opp } = withOpenMana([RED_STRIKE]);
    const attacker = addPermanent(g, me, fakeCreature("Attacker", 2, 2));
    g = setHand(attacker.state, me, []);

    g = pass(g, me);
    g = unwrap(processCommand(g, { type: "DECLARE_ATTACKERS", playerId: me, attackerIds: [attacker.instanceId] }));
    g = pass(g, me); // I'm done; they have no blockers, so this is their window to kill the attacker
    expect(g.phase).toBe("declare_blockers");
    expect(g.priorityPlayerId).toBe(opp);
    expect(getPlayer(g, opp).life).toBe(20);

    g = pass(g, opp); // they decline; damage goes through
    expect(getPlayer(g, opp).life).toBe(18);
    expect(g.phase).toBe("main2");
  });
});

describe("end-step stops (optional)", () => {
  /** My turn, main 2. The opponent holds the given hand with an untapped Mountain. */
  function atMyMain2(oppHand: CachedCard[], stopOn: boolean) {
    let g = started();
    const me = g.activePlayerId;
    const opp = opponentOf(g, me).id;
    g = addPermanent(g, opp, MOUNTAIN).state;
    g = setHand(g, me, []);
    g = setHand(g, opp, oppHand);
    g = setEndStepStop(g, opp, stopOn);
    g = pass(g, me); // end main 1 -> main 2
    expect(g.phase).toBe("main2");
    return { g, me, opp };
  }

  it("with the setting on, a usable instant stops you at the opponent's end step", () => {
    let { g, me, opp } = atMyMain2([SHOCK], true);
    g = pass(g, me); // end main 2
    expect(g.phase).toBe("end");
    expect(g.activePlayerId).toBe(me);
    expect(g.priorityPlayerId).toBe(opp);

    g = pass(g, opp); // they decline: on to their turn
    expect(g.turnNumber).toBe(2);
    expect(g.phase).toBe("main1");
  });

  it("with the setting off, the end step passes on its own", () => {
    let { g, me } = atMyMain2([SHOCK], false);
    g = pass(g, me);
    expect(g.turnNumber).toBe(2);
  });

  it("with the setting on but nothing castable, there's no stop", () => {
    let { g, me } = atMyMain2([BEAR], true);
    g = pass(g, me);
    expect(g.turnNumber).toBe(2);
  });

  it("only stops on the OPPONENT's end step, not your own", () => {
    let { g, me, opp } = atMyMain2([SHOCK], true);
    g = setEndStepStop(g, me, true);
    g = setHand(g, me, [SHOCK]);
    g = addPermanent(g, me, MOUNTAIN).state;
    g = pass(g, me);
    expect(g.phase).toBe("end");
    expect(g.priorityPlayerId).toBe(opp); // only they were stopped
  });
});

describe("the game-start keep", () => {
  it("autoAdvance on the mulligan result leaves the first player in main 1", () => {
    const g = started();
    expect(g.status).toBe("in_progress");
    expect(g.turnNumber).toBe(1);
    expect(g.phase).toBe("main1");
  });
});