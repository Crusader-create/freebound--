import { describe, expect, it } from "vitest";
import type { GameState, Target } from "../../../shared/src/types";
import { processCommand } from "./engine";
import { effectivePower, effectiveToughness } from "./permanents";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";
import {
  addPermanent,
  addToHand,
  atStep,
  BEAR,
  FELL,
  FOREST,
  GIANT_GROWTH,
  MOUNTAIN,
  PLAINS,
  pass,
  passUntil,
  SHOCK,
  STAB,
  startedGame,
  SUDDEN_STRIKE,
  SWAMP,
  unwrap,
} from "./testHelpers";

// ---------- helpers ----------

function mainPhase(): GameState {
  return passUntil(startedGame(), atStep(1, "main1"));
}

function castOn(state: GameState, playerId: string, cardInstanceId: string, targets: Target[]) {
  return processCommand(state, { type: "CAST_SPELL", playerId, cardInstanceId, targets });
}

const playerTarget = (playerId: string): Target => ({ kind: "player", playerId });
const permTarget = (instanceId: string): Target => ({ kind: "permanent", instanceId });

function graveyardNames(state: GameState, playerId: string): string[] {
  return getPlayer(state, playerId).graveyard.map((c) => c.card.name);
}

function battlefieldNames(state: GameState, playerId: string): string[] {
  return getPlayer(state, playerId).battlefield.map((p) => p.card.name);
}

// ---------- damage ----------

describe("burn spells", () => {
  it("a resolved Shock deals damage to a player and goes to the graveyard", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    const hand = addToHand(state, me, SHOCK);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [playerTarget(opp)]));
    expect(game.stack).toHaveLength(1);
    expect(getPlayer(game, opp).life).toBe(20); // nothing happens until it resolves

    game = pass(pass(game));
    expect(getPlayer(game, opp).life).toBe(18);
    expect(graveyardNames(game, me)).toContain(SHOCK.name);
    expect(game.stack).toHaveLength(0);
  });

  it("damage equal to toughness kills a creature (state-based action)", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    const bear = addPermanent(state, opp, BEAR); // 2/2
    const hand = addToHand(bear.state, me, SHOCK);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]));
    game = pass(pass(game));

    expect(battlefieldNames(game, opp)).not.toContain(BEAR.name);
    expect(graveyardNames(game, opp)).toContain(BEAR.name);
  });

  it("damage short of lethal leaves the creature alive, then wears off at end of turn", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    const bear = addPermanent(state, opp, BEAR, { toughnessModifier: 1 }); // 2/3
    const hand = addToHand(bear.state, me, SHOCK);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]));
    game = pass(pass(game));

    const damaged = getPlayer(game, opp).battlefield[0];
    expect(damaged.damageMarked).toBe(2);

    game = passUntil(game, (s) => s.turnNumber === 2);
    const healed = getPlayer(game, opp).battlefield[0];
    expect(healed.damageMarked).toBe(0);
  });

  it("a player reduced to 0 life loses the game", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    state = replacePlayer(state, { ...getPlayer(state, opp), life: 2 });
    const hand = addToHand(state, me, SHOCK);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [playerTarget(opp)]));
    game = pass(pass(game));

    expect(game.status).toBe("finished");
    expect(game.winnerId).toBe(me);
    expect(game.endReason).toBe("life");
    expect(processCommand(game, { type: "PASS_PRIORITY", playerId: game.priorityPlayerId }).ok).toBe(false);
  });
});

// ---------- pump and destroy ----------

describe("pump and destroy spells", () => {
  it("a pump spell changes effective stats and wears off at end of turn", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    state = addPermanent(state, me, FOREST).state;
    const bear = addPermanent(state, me, BEAR);
    const hand = addToHand(bear.state, me, GIANT_GROWTH);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]));
    game = pass(pass(game));

    const pumped = getPlayer(game, me).battlefield.find((p) => p.instanceId === bear.instanceId);
    expect(pumped && effectivePower(pumped)).toBe(5);
    expect(pumped && effectiveToughness(pumped)).toBe(5);

    game = passUntil(game, (s) => s.turnNumber === 2);
    const after = getPlayer(game, me).battlefield.find((p) => p.instanceId === bear.instanceId);
    expect(after && effectivePower(after)).toBe(2);
  });

  it("a -X/-X spell that drops toughness to 0 kills the creature", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, SWAMP).state;
    const bear = addPermanent(state, opp, BEAR); // 2/2
    const hand = addToHand(bear.state, me, STAB);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]));
    game = pass(pass(game));

    expect(graveyardNames(game, opp)).toContain(BEAR.name);
  });

  it("a destroy sorcery removes the creature", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, SWAMP).state;
    state = addPermanent(state, me, SWAMP).state;
    const bear = addPermanent(state, opp, BEAR);
    const hand = addToHand(bear.state, me, FELL);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]));
    game = pass(pass(game));

    expect(graveyardNames(game, opp)).toContain(BEAR.name);
    expect(graveyardNames(game, me)).toContain(FELL.name);
  });

  it("a destroyed creature goes to its OWNER's graveyard", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, SWAMP).state;
    state = addPermanent(state, me, SWAMP).state;
    // A creature that the opponent owns but I control.
    const stolen = addPermanent(state, me, BEAR, { ownerId: opp });
    const hand = addToHand(stolen.state, me, FELL);

    let game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(stolen.instanceId)]));
    game = pass(pass(game));

    expect(graveyardNames(game, opp)).toContain(BEAR.name);
    expect(graveyardNames(game, me)).not.toContain(BEAR.name);
  });
});

// ---------- the stack: responses and ordering ----------

describe("responding on the stack", () => {
  it("a pump spell cast in response resolves FIRST and saves the creature", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    state = addPermanent(state, opp, FOREST).state;
    const bear = addPermanent(state, opp, BEAR); // 2/2
    const shock = addToHand(bear.state, me, SHOCK);
    const growth = addToHand(shock.state, opp, GIANT_GROWTH);

    // I Shock their Bear...
    let game = unwrap(castOn(growth.state, me, shock.instanceId, [permTarget(bear.instanceId)]));
    game = pass(game); // ...and pass; now the opponent has priority.
    expect(game.priorityPlayerId).toBe(opp);

    // They respond with Giant Growth on their own Bear.
    game = unwrap(castOn(game, opp, growth.instanceId, [permTarget(bear.instanceId)]));
    expect(game.stack).toHaveLength(2);
    expect(game.stack[game.stack.length - 1].source.card.name).toBe(GIANT_GROWTH.name); // top

    // Both pass: the TOP of the stack (Giant Growth) resolves first.
    game = pass(pass(game));
    expect(game.stack).toHaveLength(1);
    expect(game.stack[0].source.card.name).toBe(SHOCK.name);
    expect(game.priorityPlayerId).toBe(me); // active player gets priority again

    // Both pass again: Shock resolves against a 5/5 and doesn't kill it.
    game = pass(pass(game));
    expect(game.stack).toHaveLength(0);
    const survivor = getPlayer(game, opp).battlefield.find((p) => p.instanceId === bear.instanceId);
    expect(survivor).toBeDefined();
    expect(survivor?.damageMarked).toBe(2);
  });

  it("a spell whose target is gone fizzles without doing anything", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    state = addPermanent(state, opp, SWAMP).state;
    const bear = addPermanent(state, opp, BEAR);
    const shock = addToHand(bear.state, me, SHOCK);
    const stab = addToHand(shock.state, opp, STAB);

    // I Shock their Bear; in response they Stab their own Bear (killing it).
    let game = unwrap(castOn(stab.state, me, shock.instanceId, [permTarget(bear.instanceId)]));
    game = pass(game);
    game = unwrap(castOn(game, opp, stab.instanceId, [permTarget(bear.instanceId)]));

    game = pass(pass(game)); // Stab resolves: the Bear dies
    expect(graveyardNames(game, opp)).toContain(BEAR.name);

    game = pass(pass(game)); // Shock resolves with no legal target: it fizzles
    expect(game.stack).toHaveLength(0);
    expect(getPlayer(game, opp).life).toBe(20);
    expect(graveyardNames(game, me)).toContain(SHOCK.name);
  });
});

// ---------- timing ----------

describe("spell timing", () => {
  it("an instant can be cast outside a main phase", () => {
    let state = passUntil(startedGame(), atStep(1, "beginning_of_combat"));
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    const hand = addToHand(state, me, SHOCK);
    expect(castOn(hand.state, me, hand.instanceId, [playerTarget(opp)]).ok).toBe(true);
  });

  it("an instant can be cast on the opponent's turn when holding priority", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = pass(state); // I pass; the opponent now has priority in my main phase
    state = addPermanent(state, opp, MOUNTAIN).state;
    const hand = addToHand(state, opp, SHOCK);
    expect(castOn(hand.state, opp, hand.instanceId, [playerTarget(me)]).ok).toBe(true);
  });

  it("a sorcery is refused outside a main phase", () => {
    let state = passUntil(startedGame(), atStep(1, "beginning_of_combat"));
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, SWAMP).state;
    state = addPermanent(state, me, SWAMP).state;
    const bear = addPermanent(state, opp, BEAR);
    const hand = addToHand(bear.state, me, FELL);
    expect(castOn(hand.state, me, hand.instanceId, [permTarget(bear.instanceId)]).ok).toBe(false);
  });

  it("a sorcery is refused while something is on the stack", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    for (let i = 0; i < 3; i++) state = addPermanent(state, me, SWAMP).state;
    state = addPermanent(state, me, MOUNTAIN).state;
    const bear = addPermanent(state, opp, BEAR);
    const shock = addToHand(bear.state, me, SHOCK);
    const fell = addToHand(shock.state, me, FELL);

    const afterShock = unwrap(castOn(fell.state, me, shock.instanceId, [playerTarget(opp)]));
    expect(castOn(afterShock, me, fell.instanceId, [permTarget(bear.instanceId)]).ok).toBe(false);
  });

  it("a spell can't be cast without the mana for it", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    const hand = addToHand(state, me, SHOCK); // no Mountain
    expect(castOn(hand.state, me, hand.instanceId, [playerTarget(opp)]).ok).toBe(false);
  });
});

// ---------- targeting rules ----------

describe("targeting", () => {
  function shockReady() {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, MOUNTAIN).state;
    const hand = addToHand(state, me, SHOCK);
    return { state: hand.state, me, opp, spellId: hand.instanceId };
  }

  it("requires exactly one target", () => {
    const { state, me, opp, spellId } = shockReady();
    expect(castOn(state, me, spellId, []).ok).toBe(false);
    expect(castOn(state, me, spellId, [playerTarget(opp), playerTarget(me)]).ok).toBe(false);
  });

  it("refuses a target that doesn't exist", () => {
    const { state, me, spellId } = shockReady();
    expect(castOn(state, me, spellId, [permTarget("no-such-creature")]).ok).toBe(false);
    expect(castOn(state, me, spellId, [playerTarget("no-such-player")]).ok).toBe(false);
  });

  it("refuses a player target for a creature-only spell", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, FOREST).state;
    const hand = addToHand(state, me, GIANT_GROWTH);
    expect(castOn(hand.state, me, hand.instanceId, [playerTarget(opp)]).ok).toBe(false);
  });

  it("refuses a land as a target", () => {
    const { state, me, spellId } = shockReady();
    const land = addPermanent(state, me, FOREST);
    expect(castOn(land.state, me, spellId, [permTarget(land.instanceId)]).ok).toBe(false);
  });

  it("refuses a spell targeting a spell, which isn't supported yet", () => {
    const { state, me, spellId } = shockReady();
    expect(castOn(state, me, spellId, [{ kind: "stack", stackId: "x" }]).ok).toBe(false);
  });

  it("'attacking or blocking' needs a creature that is attacking or blocking", () => {
    let state = mainPhase();
    const me = state.activePlayerId;
    const opp = opponentOf(state, me).id;
    state = addPermanent(state, me, PLAINS).state;
    state = addPermanent(state, me, PLAINS).state;
    const idle = addPermanent(state, opp, BEAR);
    const attacker = addPermanent(idle.state, opp, BEAR, { attacking: true });
    const hand = addToHand(attacker.state, me, SUDDEN_STRIKE);

    expect(castOn(hand.state, me, hand.instanceId, [permTarget(idle.instanceId)]).ok).toBe(false);

    const game = unwrap(castOn(hand.state, me, hand.instanceId, [permTarget(attacker.instanceId)]));
    const resolved = pass(pass(game));
    expect(graveyardNames(resolved, opp)).toContain(BEAR.name);
    expect(getPlayer(resolved, opp).battlefield).toHaveLength(1); // the idle Bear survives
  });
});