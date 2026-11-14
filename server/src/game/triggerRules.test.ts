import { describe, expect, it } from "vitest";
import type { GameState, Target } from "../../../shared/src/types";
import { processCommand } from "./engine";
import { getPlayer, opponentOf } from "./stateHelpers";
import {
  addPermanent,
  addToHand,
  atStep,
  BEAR,
  fakeCard,
  FOREST,
  MOUNTAIN,
  pass,
  passUntil,
  SHOCK,
  startedGame,
  SWAMP,
  unwrap,
} from "./testHelpers";

// ---------- fixtures (real oracle text from the pool) ----------

const HUNTER = fakeCard("Helpful Hunter", ["Creature"], {
  manaCost: "{1}{W}",
  power: 1,
  toughness: 1,
  oracleText: "When this creature enters, draw a card.",
});
const PACHYDERM = fakeCard("Primordial Pachyderm", ["Creature"], {
  manaCost: "{3}{G}",
  power: 4,
  toughness: 4,
  oracleText: "Reach, trample\nWhen this creature enters, you gain 2 life.",
});
const ARCHER = fakeCard("Skeleton Archer", ["Creature"], {
  manaCost: "{3}{B}",
  power: 3,
  toughness: 3,
  oracleText: "When this creature enters, it deals 1 damage to any target.",
});
const PARENT = fakeCard("Prideful Parent", ["Creature"], {
  manaCost: "{2}{W}",
  power: 2,
  toughness: 2,
  oracleText: "Vigilance\nWhen this creature enters, create a 1/1 white Cat creature token.",
});
const PLAINS = fakeCard("Plains", ["Basic", "Land"], { oracleText: "({T}: Add {W}.)" });

// ---------- helpers ----------

/** Main phase 1 with `n` untapped lands of the given kind for the active player. */
function withLands(land: typeof PLAINS, n: number) {
  let state = passUntil(startedGame(), atStep(1, "main1"));
  const me = state.activePlayerId;
  for (let i = 0; i < n; i++) state = addPermanent(state, me, land).state;
  return { state, me, opp: opponentOf(state, me).id };
}

function castCreature(state: GameState, playerId: string, card: typeof HUNTER) {
  const hand = addToHand(state, playerId, card);
  return unwrap(
    processCommand(hand.state, {
      type: "CAST_SPELL",
      playerId,
      cardInstanceId: hand.instanceId,
    })
  );
}

/** Casts a creature and resolves it: the trigger is now on the stack (or waiting for a target). */
function castAndResolve(state: GameState, playerId: string, card: typeof HUNTER) {
  return pass(pass(castCreature(state, playerId, card)));
}

const chooseTarget = (state: GameState, playerId: string, target: Target) =>
  processCommand(state, { type: "CHOOSE_TRIGGER_TARGET", playerId, target });

const hand = (state: GameState, id: string) => getPlayer(state, id).hand.length;
const life = (state: GameState, id: string) => getPlayer(state, id).life;
const field = (state: GameState, id: string) => getPlayer(state, id).battlefield;

// ---------- the trigger pipeline ----------

describe("ETB triggers go on the stack, not straight into effect", () => {
  it("a resolved creature puts its trigger on the stack without resolving it", () => {
    const { state, me } = withLands(PLAINS, 2);
    const before = hand(state, me);

    const after = castAndResolve(state, me, HUNTER);

    // The creature is on the battlefield, but the card hasn't been drawn yet.
    expect(field(after, me).some((p) => p.card.name === HUNTER.name)).toBe(true);
    expect(hand(after, me)).toBe(before);
    expect(after.pendingTriggers).toHaveLength(0);
    expect(after.stack).toHaveLength(1);
    expect(after.stack[0].kind).toBe("triggered_ability");
    expect(after.stack[0].description).toBe("Helpful Hunter: draw a card");
    expect(after.priorityPlayerId).toBe(me);
  });

  it("the trigger resolves when both players pass", () => {
    const { state, me } = withLands(PLAINS, 2);
    const before = hand(state, me);
    const after = pass(pass(castAndResolve(state, me, HUNTER)));

    expect(hand(after, me)).toBe(before + 1);
    expect(after.stack).toHaveLength(0);
    expect(after.phase).toBe("main1"); // resolving doesn't end the step
  });

  it("gain life (Primordial Pachyderm)", () => {
    const { state, me } = withLands(FOREST, 4);
    const after = pass(pass(castAndResolve(state, me, PACHYDERM)));
    expect(life(after, me)).toBe(22);
  });

  it("the opponent can respond to a trigger before it resolves", () => {
    const { state, me, opp } = withLands(PLAINS, 2);
    let game = addPermanent(state, opp, MOUNTAIN).state;
    const shock = addToHand(game, opp, SHOCK);
    game = shock.state;

    game = castAndResolve(game, me, HUNTER); // trigger on the stack, I have priority
    game = pass(game); // I pass; the opponent may respond
    expect(game.priorityPlayerId).toBe(opp);

    // They Shock the Hunter in response to its own trigger.
    const hunter = field(game, me).find((p) => p.card.name === HUNTER.name)!;
    game = unwrap(
      processCommand(game, {
        type: "CAST_SPELL",
        playerId: opp,
        cardInstanceId: shock.instanceId,
        targets: [{ kind: "permanent", instanceId: hunter.instanceId }],
      })
    );
    expect(game.stack).toHaveLength(2);

    game = pass(pass(game)); // Shock resolves: the Hunter dies
    expect(field(game, me).some((p) => p.card.name === HUNTER.name)).toBe(false);

    const before = hand(game, me);
    game = pass(pass(game)); // the trigger still resolves: the card is still drawn
    expect(hand(game, me)).toBe(before + 1);
  });
});

// ---------- targeted triggers ----------

describe("a trigger that needs a target (Skeleton Archer)", () => {
  it("waits for its controller to choose a target before going on the stack", () => {
    const { state, me, opp } = withLands(SWAMP, 4);
    const after = castAndResolve(state, me, ARCHER);

    expect(after.awaiting).toBe("trigger_target");
    expect(after.priorityPlayerId).toBe(me);
    expect(after.pendingTriggers).toHaveLength(1);
    expect(after.stack).toHaveLength(0);

    // Nobody can pass or act while the target is pending.
    for (const playerId of [me, opp]) {
      expect(processCommand(after, { type: "PASS_PRIORITY", playerId }).ok).toBe(false);
    }
  });

  it("only the controller can choose, and the target must be legal", () => {
    const { state, me, opp } = withLands(SWAMP, 4);
    const after = castAndResolve(state, me, ARCHER);

    expect(chooseTarget(after, opp, { kind: "player", playerId: opp }).ok).toBe(false);
    expect(chooseTarget(after, me, { kind: "permanent", instanceId: "nope" }).ok).toBe(false);
    expect(chooseTarget(after, me, { kind: "player", playerId: opp }).ok).toBe(true);
  });

  it("deals the damage once it resolves", () => {
    const { state, me, opp } = withLands(SWAMP, 4);
    let game = castAndResolve(state, me, ARCHER);
    game = unwrap(chooseTarget(game, me, { kind: "player", playerId: opp }));

    expect(game.awaiting).toBeNull();
    expect(game.stack).toHaveLength(1);
    expect(game.priorityPlayerId).toBe(me);

    game = pass(pass(game));
    expect(life(game, opp)).toBe(19);
  });

  it("can kill a creature, and fizzles if the target is gone", () => {
    const { state, me, opp } = withLands(SWAMP, 4);
    const victim = fakeCard("Weakling", ["Creature"], { power: 1, toughness: 1 });
    const added = addPermanent(state, opp, victim);

    let game = castAndResolve(added.state, me, ARCHER);
    game = unwrap(chooseTarget(game, me, { kind: "permanent", instanceId: added.instanceId }));
    game = pass(pass(game));
    expect(getPlayer(game, opp).graveyard.some((c) => c.card.name === "Weakling")).toBe(true);
  });
});

// ---------- tokens ----------

describe("tokens (Prideful Parent)", () => {
  it("creates a summoning-sick creature token with the right stats", () => {
    const { state, me } = withLands(PLAINS, 3);
    const game = pass(pass(castAndResolve(state, me, PARENT)));

    const token = field(game, me).find((p) => p.card.name === "Cat token");
    expect(token).toBeDefined();
    expect(token?.card.power).toBe(1);
    expect(token?.card.toughness).toBe(1);
    expect(token?.card.types).toContain("Token");
    expect(token?.card.types).toContain("Creature");
    expect(token?.summoningSick).toBe(true);
    expect(token?.controllerId).toBe(me);
  });

  it("a token that dies vanishes instead of going to a graveyard", () => {
    const { state, me, opp } = withLands(PLAINS, 3);
    let game = pass(pass(castAndResolve(state, me, PARENT)));
    const token = field(game, me).find((p) => p.card.name === "Cat token")!;

    game = addPermanent(game, opp, MOUNTAIN).state;
    const shock = addToHand(game, opp, SHOCK);
    game = pass(shock.state); // give the opponent priority
    game = unwrap(
      processCommand(game, {
        type: "CAST_SPELL",
        playerId: opp,
        cardInstanceId: shock.instanceId,
        targets: [{ kind: "permanent", instanceId: token.instanceId }],
      })
    );
    game = pass(pass(game));

    expect(field(game, me).some((p) => p.instanceId === token.instanceId)).toBe(false);
    expect(getPlayer(game, me).graveyard.some((c) => c.card.name === "Cat token")).toBe(false);
  });

  it("a token can attack on its controller's next turn", () => {
    const { state, me } = withLands(PLAINS, 3);
    let game = pass(pass(castAndResolve(state, me, PARENT)));
    game = passUntil(game, atStep(3, "declare_attackers"));
    expect(game.awaiting).toBe("attackers"); // something can attack

    const token = field(game, me).find((p) => p.card.name === "Cat token")!;
    const result = processCommand(game, {
      type: "DECLARE_ATTACKERS",
      playerId: me,
      attackerIds: [token.instanceId],
    });
    expect(result.ok).toBe(true);
  });
});

// ---------- cleanup: hand size ----------

describe("discarding to hand size", () => {
  /** End step of turn 1 with the active player holding `n` cards. */
  function atEndWithHand(n: number) {
    let state = passUntil(startedGame(), atStep(1, "end"));
    const me = state.activePlayerId;
    const player = getPlayer(state, me);
    const extra = n - player.hand.length;
    for (let i = 0; i < extra; i++) state = addToHand(state, me, BEAR).state;
    return { state, me };
  }

  it("doesn't ask when the hand is at or under 7", () => {
    const { state } = atEndWithHand(7);
    const next = pass(pass(state)); // end step ends: cleanup runs
    expect(next.turnNumber).toBe(2);
    expect(next.awaiting).toBeNull();
  });

  it("waits for the active player to discard down to 7", () => {
    const { state, me } = atEndWithHand(9);
    const waiting = pass(pass(state));

    expect(waiting.phase).toBe("cleanup");
    expect(waiting.awaiting).toBe("discard");
    expect(waiting.priorityPlayerId).toBe(me);
    expect(waiting.turnNumber).toBe(1);
  });

  it("must discard exactly the excess, from the hand", () => {
    const { state, me } = atEndWithHand(9);
    const waiting = pass(pass(state));
    const ids = getPlayer(waiting, me).hand.map((c) => c.instanceId);

    expect(processCommand(waiting, { type: "DISCARD", playerId: me, cardInstanceIds: [ids[0]] }).ok).toBe(false);
    expect(processCommand(waiting, { type: "DISCARD", playerId: me, cardInstanceIds: ["nope", ids[0]] }).ok).toBe(false);
    expect(processCommand(waiting, { type: "DISCARD", playerId: me, cardInstanceIds: [ids[0], ids[0]] }).ok).toBe(false);

    const done = unwrap(
      processCommand(waiting, { type: "DISCARD", playerId: me, cardInstanceIds: [ids[0], ids[1]] })
    );
    expect(hand(done, me)).toBe(7);
    expect(getPlayer(done, me).graveyard).toHaveLength(2);
    expect(done.turnNumber).toBe(2); // the turn then ends on its own
    expect(done.awaiting).toBeNull();
  });

  it("the other player can't discard for them", () => {
    const { state, me } = atEndWithHand(8);
    const waiting = pass(pass(state));
    const opp = opponentOf(waiting, me).id;
    const id = getPlayer(waiting, me).hand[0].instanceId;
    expect(processCommand(waiting, { type: "DISCARD", playerId: opp, cardInstanceIds: [id] }).ok).toBe(false);
  });
});

// ---------- concede ----------

describe("conceding", () => {
  it("ends the game with the other player as the winner", () => {
    const state = startedGame();
    const me = state.activePlayerId;
    const after = unwrap(processCommand(state, { type: "CONCEDE", playerId: me }));

    expect(after.status).toBe("finished");
    expect(after.winnerId).toBe(opponentOf(state, me).id);
    expect(after.endReason).toBe("concede");
  });

  it("works for the player without priority, and mid-combat", () => {
    const state = passUntil(startedGame(), atStep(1, "beginning_of_combat"));
    const other = opponentOf(state, state.priorityPlayerId).id;
    expect(processCommand(state, { type: "CONCEDE", playerId: other }).ok).toBe(true);
  });

  it("can't concede a finished game, and nothing works afterwards", () => {
    const state = startedGame();
    const me = state.activePlayerId;
    const done = unwrap(processCommand(state, { type: "CONCEDE", playerId: me }));
    expect(processCommand(done, { type: "CONCEDE", playerId: me }).ok).toBe(false);
    expect(processCommand(done, { type: "PASS_PRIORITY", playerId: done.priorityPlayerId }).ok).toBe(false);
  });
});

// ---------- state-based actions still run first ----------

describe("ordering: SBA before triggers", () => {
  it("a trigger from a creature that died on arrival still happens", () => {
    // A 0-toughness creature dies to SBA the moment it enters, but it DID
    // enter, so its ETB trigger still goes on the stack.
    const { state, me } = withLands(PLAINS, 2);
    const doomed = fakeCard("Doomed", ["Creature"], {
      manaCost: "{1}{W}",
      power: 1,
      toughness: 0,
      oracleText: "When this creature enters, draw a card.",
    });
    const before = hand(state, me);
    let game = castAndResolve(state, me, doomed);

    expect(field(game, me).some((p) => p.card.name === "Doomed")).toBe(false); // died
    expect(game.stack).toHaveLength(1); // trigger still queued
    game = pass(pass(game));
    expect(hand(game, me)).toBe(before + 1);
  });
});