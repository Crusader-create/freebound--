import { describe, expect, it } from "vitest";
import type {
  BattlefieldCard,
  CachedCard,
  GameState,
  Phase,
} from "../../../shared/src/types";
import type { BlockAssignment } from "./combat";
import { processCommand } from "./engine";
import { destroyPermanent } from "./permanents";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";
import {
  addPermanent,
  addToHand,
  fakeCreature,
  FOREST,
  pass,
  passUntil,
  startedGame,
  unwrap,
} from "./testHelpers";

// ---------- fixtures and helpers ----------

const ATTACKER = fakeCreature("Attacker", 2, 2);
const BLOCKER = fakeCreature("Blocker", 2, 2);

type Spec = { card: CachedCard; overrides?: Partial<BattlefieldCard> };

/**
 * Turn 1, main phase 1, with the given creatures on each battlefield, then
 * walked forward to the declare attackers step.
 */
function setup(mine: Spec[], theirs: Spec[]) {
  let state = startedGame();
  const me = state.activePlayerId;
  const opp = opponentOf(state, me).id;
  const mineIds: string[] = [];
  const theirIds: string[] = [];

  for (const spec of mine) {
    const added = addPermanent(state, me, spec.card, spec.overrides);
    state = added.state;
    mineIds.push(added.instanceId);
  }
  for (const spec of theirs) {
    const added = addPermanent(state, opp, spec.card, spec.overrides);
    state = added.state;
    theirIds.push(added.instanceId);
  }

  state = passUntil(state, (s) => s.phase === "declare_attackers");
  return { state, me, opp, mineIds, theirIds };
}

function declareAttackers(state: GameState, ids: string[]) {
  return processCommand(state, {
    type: "DECLARE_ATTACKERS",
    playerId: state.activePlayerId,
    attackerIds: ids,
  });
}

function declareBlockers(state: GameState, blocks: BlockAssignment[]) {
  return processCommand(state, {
    type: "DECLARE_BLOCKERS",
    playerId: opponentOf(state, state.activePlayerId).id,
    blocks,
  });
}

const block = (blockerId: string, attackerId: string): BlockAssignment => ({
  blockerId,
  attackerId,
});

/** Attackers declared, both players pass: now at declare blockers. */
function toBlockers(state: GameState, attackerIds: string[]): GameState {
  return pass(pass(unwrap(declareAttackers(state, attackerIds))));
}

/** Declares attackers, then blockers (if asked), and walks forward to `until`. */
function fight(
  state: GameState,
  attackerIds: string[],
  blocks: BlockAssignment[],
  until: Phase
): GameState {
  let s = toBlockers(state, attackerIds);
  if (s.awaiting === "blockers") s = unwrap(declareBlockers(s, blocks));
  return passUntil(s, (x) => x.phase === until);
}

const life = (state: GameState, playerId: string) => getPlayer(state, playerId).life;
const graveyard = (state: GameState, playerId: string) =>
  getPlayer(state, playerId).graveyard.map((c) => c.card.name);
const battlefield = (state: GameState, playerId: string) =>
  getPlayer(state, playerId).battlefield.map((p) => p.card.name);

// ---------- declaring attackers ----------

describe("declaring attackers", () => {
  it("asks the active player to declare when a creature can attack", () => {
    const { state } = setup([{ card: ATTACKER }], []);
    expect(state.phase).toBe("declare_attackers");
    expect(state.awaiting).toBe("attackers");
    expect(state.priorityPlayerId).toBe(state.activePlayerId);
  });

  it("doesn't ask when no creature can attack, and skips on to end of combat", () => {
    const { state } = setup([{ card: ATTACKER, overrides: { summoningSick: true } }], []);
    expect(state.awaiting).toBeNull();
    expect(pass(pass(state)).phase).toBe("end_of_combat");
  });

  it("marks attackers as attacking and taps them", () => {
    const { state, me, mineIds } = setup([{ card: ATTACKER }], []);
    const after = unwrap(declareAttackers(state, mineIds));
    const attacker = getPlayer(after, me).battlefield[0];

    expect(attacker.attacking).toBe(true);
    expect(attacker.tapped).toBe(true);
    expect(after.awaiting).toBeNull();
    expect(after.priorityPlayerId).toBe(me);
  });

  it("vigilance: attacks without tapping", () => {
    const vigil = fakeCreature("Vigil", 2, 2, "Vigilance");
    const { state, me, mineIds } = setup([{ card: vigil }], []);
    const attacker = getPlayer(unwrap(declareAttackers(state, mineIds)), me).battlefield[0];
    expect(attacker.attacking).toBe(true);
    expect(attacker.tapped).toBe(false);
  });

  it("haste: a summoning-sick creature can still attack", () => {
    const hasty = fakeCreature("Hasty", 2, 1, "Haste");
    const { state, mineIds } = setup([{ card: hasty, overrides: { summoningSick: true } }], []);
    expect(state.awaiting).toBe("attackers");
    expect(declareAttackers(state, mineIds).ok).toBe(true);
  });

  it("defender: can't attack", () => {
    const wall = fakeCreature("Wall", 0, 4, "Defender");
    const { state, mineIds } = setup([{ card: ATTACKER }, { card: wall }], []);
    expect(declareAttackers(state, mineIds).ok).toBe(false); // both, including the wall
    expect(declareAttackers(state, [mineIds[0]]).ok).toBe(true);
  });

  it("refuses a tapped creature", () => {
    const { state, mineIds } = setup(
      [{ card: ATTACKER }, { card: ATTACKER, overrides: { tapped: true } }],
      []
    );
    expect(declareAttackers(state, mineIds).ok).toBe(false);
    expect(declareAttackers(state, [mineIds[0]]).ok).toBe(true);
  });

  it("refuses a summoning-sick creature", () => {
    const { state, mineIds } = setup(
      [{ card: ATTACKER }, { card: ATTACKER, overrides: { summoningSick: true } }],
      []
    );
    expect(declareAttackers(state, [mineIds[1]]).ok).toBe(false);
  });

  it("refuses the opponent's creature, or the same creature twice", () => {
    const { state, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    expect(declareAttackers(state, theirIds).ok).toBe(false);
    expect(declareAttackers(state, [mineIds[0], mineIds[0]]).ok).toBe(false);
  });

  it("only the active player can declare attackers", () => {
    const { state, opp, mineIds } = setup([{ card: ATTACKER }], []);
    const result = processCommand(state, {
      type: "DECLARE_ATTACKERS",
      playerId: opp,
      attackerIds: mineIds,
    });
    expect(result.ok).toBe(false);
  });

  it("declaring no attackers skips blockers and damage", () => {
    const { state } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    const after = unwrap(declareAttackers(state, []));
    expect(after.awaiting).toBeNull();
    expect(pass(pass(after)).phase).toBe("end_of_combat");
  });

  it("nobody can pass priority while attackers are being declared", () => {
    const { state, me, opp } = setup([{ card: ATTACKER }], []);
    for (const playerId of [me, opp]) {
      expect(processCommand(state, { type: "PASS_PRIORITY", playerId }).ok).toBe(false);
    }
  });

  it("no other action is allowed until attackers are declared", () => {
    const { state, me } = setup([{ card: ATTACKER }], []);
    const hand = addToHand(state, me, FOREST);
    const result = processCommand(hand.state, {
      type: "PLAY_LAND",
      playerId: me,
      cardInstanceId: hand.instanceId,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/declare/i);
  });
});

// ---------- declaring blockers ----------

describe("declaring blockers", () => {
  it("asks the defender to declare when they could block", () => {
    const { state, mineIds, opp } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    const s = toBlockers(state, mineIds);
    expect(s.phase).toBe("declare_blockers");
    expect(s.awaiting).toBe("blockers");
    expect(s.priorityPlayerId).toBe(opp);
  });

  it("doesn't ask when the defender has nothing that could block", () => {
    const { state, mineIds } = setup([{ card: ATTACKER }], []);
    const s = toBlockers(state, mineIds);
    expect(s.phase).toBe("declare_blockers");
    expect(s.awaiting).toBeNull();
  });

  it("nobody can pass priority while blockers are being declared", () => {
    const { state, mineIds, me, opp } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    const s = toBlockers(state, mineIds);
    for (const playerId of [me, opp]) {
      expect(processCommand(s, { type: "PASS_PRIORITY", playerId }).ok).toBe(false);
    }
  });

  it("only the defending player can declare blockers", () => {
    const { state, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    const s = toBlockers(state, mineIds);
    const result = processCommand(s, {
      type: "DECLARE_BLOCKERS",
      playerId: s.activePlayerId,
      blocks: [block(theirIds[0], mineIds[0])],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a tapped blocker", () => {
    const { state, mineIds, theirIds } = setup(
      [{ card: ATTACKER }],
      [{ card: BLOCKER, overrides: { tapped: true } }, { card: BLOCKER }]
    );
    const s = toBlockers(state, mineIds);
    expect(declareBlockers(s, [block(theirIds[0], mineIds[0])]).ok).toBe(false);
    expect(declareBlockers(s, [block(theirIds[1], mineIds[0])]).ok).toBe(true);
  });

  it("can't block a creature that isn't attacking", () => {
    const { state, mineIds, theirIds } = setup(
      [{ card: ATTACKER }, { card: ATTACKER }],
      [{ card: BLOCKER }]
    );
    const s = toBlockers(state, [mineIds[0]]); // only the first attacks
    expect(declareBlockers(s, [block(theirIds[0], mineIds[1])]).ok).toBe(false);
  });

  it("several creatures can block the same attacker", () => {
    const { state, mineIds, theirIds } = setup(
      [{ card: ATTACKER }, { card: ATTACKER }],
      [{ card: BLOCKER }, { card: BLOCKER }]
    );
    const s = toBlockers(state, mineIds);
    const doubleBlock = [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])];
    const result = unwrap(declareBlockers(s, doubleBlock));
    const attacker = result.players
      .flatMap((pl) => pl.battlefield)
      .find((c) => c.instanceId === mineIds[0])!;
    expect(attacker.blockedBy).toEqual([theirIds[0], theirIds[1]]);

    const oneEach = [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[1])];
    expect(declareBlockers(s, oneEach).ok).toBe(true);
  });

  it("one creature can't block two attackers", () => {
    const { state, mineIds, theirIds } = setup(
      [{ card: ATTACKER }, { card: ATTACKER }],
      [{ card: BLOCKER }]
    );
    const s = toBlockers(state, mineIds);
    const result = declareBlockers(s, [
      block(theirIds[0], mineIds[0]),
      block(theirIds[0], mineIds[1]),
    ]);
    expect(result.ok).toBe(false);
  });

  it("flying: a ground creature can't block a flier, so nobody is asked", () => {
    const flier = fakeCreature("Flier", 2, 2, "Flying");
    const { state, mineIds, opp } = setup([{ card: flier }], [{ card: BLOCKER }]);
    const s = toBlockers(state, mineIds);
    expect(s.awaiting).toBeNull();

    const after = passUntil(s, (x) => x.phase === "combat_damage");
    expect(life(after, opp)).toBe(18);
  });

  it("flying and reach creatures can block a flier; ground creatures can't", () => {
    const flier = fakeCreature("Flier", 2, 2, "Flying");
    const reacher = fakeCreature("Reacher", 1, 3, "Reach");
    const { state, mineIds, theirIds } = setup([{ card: flier }], [{ card: BLOCKER }, { card: reacher }]);
    const s = toBlockers(state, mineIds);

    expect(s.awaiting).toBe("blockers");
    expect(declareBlockers(s, [block(theirIds[0], mineIds[0])]).ok).toBe(false); // ground
    expect(declareBlockers(s, [block(theirIds[1], mineIds[0])]).ok).toBe(true); // reach
  });

  it("a flying creature can block a flier", () => {
    const flier = fakeCreature("Flier", 2, 2, "Flying");
    const { state, mineIds, theirIds } = setup([{ card: flier }], [{ card: flier }]);
    const s = toBlockers(state, mineIds);
    expect(declareBlockers(s, [block(theirIds[0], mineIds[0])]).ok).toBe(true);
  });
});

// ---------- combat damage ----------

describe("combat damage", () => {
  it("an unblocked attacker damages the defending player", () => {
    const { state, mineIds, opp } = setup([{ card: ATTACKER }], []);
    const after = fight(state, mineIds, [], "combat_damage");
    expect(life(after, opp)).toBe(18);
  });

  it("two equal creatures trade, and the player takes no damage", () => {
    const { state, me, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    const after = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(after, me)).toContain("Attacker");
    expect(graveyard(after, opp)).toContain("Blocker");
    expect(life(after, opp)).toBe(20);
  });

  it("damage short of lethal stays marked on the survivors", () => {
    const tough = fakeCreature("Tough", 1, 4);
    const { state, me, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: tough }]);
    const after = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(getPlayer(after, opp).battlefield[0].damageMarked).toBe(2);
    expect(getPlayer(after, me).battlefield[0].damageMarked).toBe(1);
  });

  it("damage uses effective power, including until-end-of-turn bonuses", () => {
    const { state, opp, mineIds } = setup(
      [{ card: ATTACKER, overrides: { powerModifier: 3 } }],
      []
    );
    const after = fight(state, mineIds, [], "combat_damage");
    expect(life(after, opp)).toBe(15);
  });

  it("a creature with no power deals no damage", () => {
    const wall = fakeCreature("Wall", 0, 3);
    const { state, opp, mineIds } = setup([{ card: wall }], []);
    const after = fight(state, mineIds, [], "combat_damage");
    expect(life(after, opp)).toBe(20);
  });

  it("combat damage that takes a player to 0 life ends the game", () => {
    const base = setup([{ card: fakeCreature("Big", 3, 3) }], []);
    const state = replacePlayer(base.state, { ...getPlayer(base.state, base.opp), life: 2 });
    const after = fight(state, base.mineIds, [], "combat_damage");

    expect(after.status).toBe("finished");
    expect(after.winnerId).toBe(base.me);
    expect(after.endReason).toBe("life");
  });

  it("everything is removed from combat at the end of combat", () => {
    const tough = fakeCreature("Tough", 1, 4);
    const { state, me, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: tough }]);
    const after = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    for (const player of [me, opp]) {
      for (const p of getPlayer(after, player).battlefield) {
        expect(p.attacking).toBe(false);
        expect(p.blockedBy).toBeUndefined();
        expect(p.blockingInstanceId).toBeUndefined();
      }
    }
  });
});

// ---------- keywords in combat ----------

describe("first strike", () => {
  it("kills an equal blocker before it can deal damage", () => {
    const striker = fakeCreature("Striker", 2, 2, "First strike");
    const { state, me, opp, mineIds, theirIds } = setup([{ card: striker }], [{ card: BLOCKER }]);

    const afterFirstStrike = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "first_strike_damage");
    expect(graveyard(afterFirstStrike, opp)).toContain("Blocker");
    expect(getPlayer(afterFirstStrike, me).battlefield[0].damageMarked).toBe(0);

    const end = passUntil(afterFirstStrike, (x) => x.phase === "end_of_combat");
    expect(battlefield(end, me)).toContain("Striker");
  });

  it("a first-strike blocker kills the attacker first", () => {
    const striker = fakeCreature("Striker", 2, 2, "First strike");
    const { state, me, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: striker }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(end, me)).toContain("Attacker");
    expect(battlefield(end, opp)).toContain("Striker");
  });

  it("the first strike step only happens when someone has first strike", () => {
    function phasesFrom(start: GameState): Phase[] {
      let s = start;
      const seen: Phase[] = [s.phase];
      while (s.phase !== "end_of_combat") {
        s = pass(s);
        if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      }
      return seen;
    }

    const plain = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    let s = toBlockers(plain.state, plain.mineIds);
    s = unwrap(declareBlockers(s, [block(plain.theirIds[0], plain.mineIds[0])]));
    expect(phasesFrom(s)).toEqual(["declare_blockers", "combat_damage", "end_of_combat"]);

    const striker = fakeCreature("Striker", 2, 2, "First strike");
    const fs = setup([{ card: striker }], [{ card: BLOCKER }]);
    let t = toBlockers(fs.state, fs.mineIds);
    t = unwrap(declareBlockers(t, [block(fs.theirIds[0], fs.mineIds[0])]));
    expect(phasesFrom(t)).toEqual([
      "declare_blockers",
      "first_strike_damage",
      "combat_damage",
      "end_of_combat",
    ]);
  });
});

describe("deathtouch", () => {
  it("an attacker with deathtouch kills a much bigger blocker", () => {
    const toucher = fakeCreature("Toucher", 1, 1, "Deathtouch");
    const big = fakeCreature("Big", 4, 4);
    const { state, me, opp, mineIds, theirIds } = setup([{ card: toucher }], [{ card: big }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(end, opp)).toContain("Big");
    expect(graveyard(end, me)).toContain("Toucher"); // took 4 damage back
  });

  it("a deathtouch blocker kills a much bigger attacker", () => {
    const big = fakeCreature("Big", 4, 4);
    const toucher = fakeCreature("Toucher", 1, 1, "Deathtouch");
    const { state, me, mineIds, theirIds } = setup([{ card: big }], [{ card: toucher }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(end, me)).toContain("Big");
  });
});

describe("trample", () => {
  it("assigns lethal damage to the blocker and the rest to the player", () => {
    const trampler = fakeCreature("Trampler", 5, 5, "Trample");
    const { state, opp, mineIds, theirIds } = setup([{ card: trampler }], [{ card: BLOCKER }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(end, opp)).toContain("Blocker");
    expect(life(end, opp)).toBe(17); // 5 power - 2 toughness
  });

  it("with deathtouch, only 1 damage to the blocker is lethal", () => {
    const killer = fakeCreature("Killer", 3, 3, "Trample\nDeathtouch");
    const big = fakeCreature("Big", 5, 5);
    const { state, opp, mineIds, theirIds } = setup([{ card: killer }], [{ card: big }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(graveyard(end, opp)).toContain("Big");
    expect(life(end, opp)).toBe(18); // 3 power - 1 lethal
  });

  it("if the blocker is gone, a trampler deals all its damage to the player", () => {
    const trampler = fakeCreature("Trampler", 5, 5, "Trample");
    const { state, opp, mineIds, theirIds } = setup([{ card: trampler }], [{ card: BLOCKER }]);
    let s = toBlockers(state, mineIds);
    s = unwrap(declareBlockers(s, [block(theirIds[0], mineIds[0])]));
    s = destroyPermanent(s, theirIds[0]); // the blocker is removed before damage

    const after = passUntil(s, (x) => x.phase === "combat_damage");
    expect(life(after, opp)).toBe(15);
  });

  it("without trample, a blocked attacker whose blocker is gone deals no damage", () => {
    const { state, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: BLOCKER }]);
    let s = toBlockers(state, mineIds);
    s = unwrap(declareBlockers(s, [block(theirIds[0], mineIds[0])]));
    s = destroyPermanent(s, theirIds[0]);

    const after = passUntil(s, (x) => x.phase === "combat_damage");
    expect(life(after, opp)).toBe(20);
  });
});

describe("lifelink", () => {
  it("an unblocked lifelinker gains life as it damages the player", () => {
    const leech = fakeCreature("Leech", 2, 2, "Lifelink");
    const { state, me, opp, mineIds } = setup([{ card: leech }], []);
    const after = fight(state, mineIds, [], "combat_damage");

    expect(life(after, me)).toBe(22);
    expect(life(after, opp)).toBe(18);
  });

  it("gains life for damage dealt to a creature, even a bigger one", () => {
    const leech = fakeCreature("Leech", 2, 2, "Lifelink");
    const big = fakeCreature("Big", 5, 5);
    const { state, me, mineIds, theirIds } = setup([{ card: leech }], [{ card: big }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(life(end, me)).toBe(22);
    expect(graveyard(end, me)).toContain("Leech");
  });

  it("a lifelink blocker gains life for its controller", () => {
    const leech = fakeCreature("Leech", 2, 2, "Lifelink");
    const { state, opp, mineIds, theirIds } = setup([{ card: ATTACKER }], [{ card: leech }]);
    const end = fight(state, mineIds, [block(theirIds[0], mineIds[0])], "end_of_combat");

    expect(life(end, opp)).toBe(22);
  });
});

describe("multiple blockers", () => {
  it("two blockers gang up and kill a bigger attacker", () => {
    const big = fakeCreature("Big", 3, 3);
    const { state, me, opp, mineIds, theirIds } = setup(
      [{ card: big }],
      [{ card: BLOCKER }, { card: BLOCKER }]
    );
    const end = fight(
      state,
      mineIds,
      [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])],
      "end_of_combat"
    );

    expect(graveyard(end, me)).toContain("Big"); // took 2 + 2
    // 3 damage: 2 kills one blocker, the leftover 1 lands on the other.
    expect(graveyard(end, opp)).toEqual(["Blocker"]);
    expect(getPlayer(end, opp).battlefield[0].damageMarked).toBe(1);
    expect(life(end, opp)).toBe(20);
  });

  it("the attacker kills the blockers it can, cheapest first", () => {
    const big = fakeCreature("Big", 4, 6);
    const small = fakeCreature("Small", 1, 1);
    const wall = fakeCreature("Wall", 0, 5);
    const { state, opp, mineIds, theirIds } = setup([{ card: big }], [{ card: wall }, { card: small }]);
    const end = fight(
      state,
      mineIds,
      [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])],
      "end_of_combat"
    );

    expect(graveyard(end, opp)).toEqual(["Small"]); // 1 to Small, 3 to Wall
    expect(battlefield(end, opp)).toEqual(["Wall"]);
    expect(getPlayer(end, opp).battlefield[0].damageMarked).toBe(3);
  });

  it("trample: lethal to every blocker, the rest to the player", () => {
    const trampler = fakeCreature("Trampler", 5, 5, "Trample");
    const { state, opp, mineIds, theirIds } = setup(
      [{ card: trampler }],
      [{ card: BLOCKER }, { card: BLOCKER }]
    );
    const end = fight(
      state,
      mineIds,
      [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])],
      "end_of_combat"
    );

    expect(graveyard(end, opp)).toEqual(["Blocker", "Blocker"]);
    expect(life(end, opp)).toBe(19);
  });

  it("deathtouch: 1 damage to each blocker is enough", () => {
    const toucher = fakeCreature("Toucher", 2, 5, "Deathtouch");
    const big = fakeCreature("Big", 1, 6);
    const { state, opp, mineIds, theirIds } = setup([{ card: toucher }], [{ card: big }, { card: big }]);
    const end = fight(
      state,
      mineIds,
      [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])],
      "end_of_combat"
    );

    expect(graveyard(end, opp)).toEqual(["Big", "Big"]);
  });

  it("if one blocker is removed, the attacker's damage all goes to the other", () => {
    const big = fakeCreature("Big", 4, 4);
    const { state, opp, mineIds, theirIds } = setup(
      [{ card: big }],
      [{ card: BLOCKER }, { card: fakeCreature("Tough", 1, 5) }]
    );
    let s = toBlockers(state, mineIds);
    s = unwrap(declareBlockers(s, [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])]));
    s = destroyPermanent(s, theirIds[0]);

    const after = passUntil(s, (x) => x.phase === "end_of_combat");
    expect(getPlayer(after, opp).battlefield.find((c) => c.card.name === "Tough")!.damageMarked).toBe(4);
    expect(life(after, opp)).toBe(20);
  });

  it("first strike: a first-strike attacker kills one blocker before it can hit back", () => {
    const striker = fakeCreature("Striker", 2, 3, "First strike");
    const { state, me, opp, mineIds, theirIds } = setup(
      [{ card: striker }],
      [{ card: BLOCKER }, { card: BLOCKER }]
    );
    const end = fight(
      state,
      mineIds,
      [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])],
      "end_of_combat"
    );

    expect(graveyard(end, opp)).toEqual(["Blocker"]);
    // Only the surviving blocker deals 2, so the 2/3 striker lives.
    expect(battlefield(end, me)).toContain("Striker");
  });

  it("the log names every blocker", () => {
    const big = fakeCreature("Big", 3, 3);
    const { state, mineIds, theirIds } = setup([{ card: big }], [{ card: BLOCKER }, { card: BLOCKER }]);
    const s = toBlockers(state, mineIds);
    const after = unwrap(
      declareBlockers(s, [block(theirIds[0], mineIds[0]), block(theirIds[1], mineIds[0])])
    );
    expect(after.log.at(-1)!.text).toContain("Blocker and Blocker blocked Big");
  });
});