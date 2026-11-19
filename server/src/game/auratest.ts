/**
 * aura.test.ts
 *
 * Pacifism: "Enchant creature. Enchanted creature can't attack or block."
 * Cast at sorcery speed targeting a creature; it enters attached to it.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../../shared/src/types";
import { eligibleAttackers, eligibleBlockers, pacifiedIds } from "./combat";
import { getSpellEffect } from "./effects";
import { processCommand } from "./engine";
import { destroyPermanent } from "./permanents";
import { applyStateBasedActions } from "./sba";
import { getPlayer, opponentOf } from "./stateHelpers";
import {
  PLAINS,
  addPermanent,
  addToHand,
  atStep,
  fakeCard,
  fakeCreature,
  passUntil,
  startedGame,
  unwrap,
} from "./testHelpers";

const PACIFISM = fakeCard("Pacifism", ["Enchantment"], {
  manaCost: "{1}{W}",
  oracleText: "Enchant creature\nEnchanted creature can't attack or block.",
});

/** My main phase 1 with two Plains, Pacifism in hand, and a creature on each side. */
function setup() {
  let g = passUntil(startedGame(), atStep(1, "main1"));
  const me = g.activePlayerId;
  const opp = opponentOf(g, me).id;
  g = addPermanent(g, me, PLAINS).state;
  g = addPermanent(g, me, PLAINS).state;
  const mine = addPermanent(g, me, fakeCreature("My Bear", 2, 2));
  const theirs = addPermanent(mine.state, opp, fakeCreature("Their Bear", 2, 2));
  const hand = addToHand(theirs.state, me, PACIFISM);
  return { g: hand.state, me, opp, pacifism: hand.instanceId, myBear: mine.instanceId, theirBear: theirs.instanceId };
}

function cast(g: GameState, playerId: string, cardId: string, creatureId: string) {
  return processCommand(g, {
    type: "CAST_SPELL",
    playerId,
    cardInstanceId: cardId,
    targets: [{ kind: "permanent", instanceId: creatureId }],
  });
}

/** Both players pass until the stack is empty again. */
function resolveAll(g: GameState): GameState {
  return passUntil(g, (s) => s.stack.length === 0);
}

describe("Pacifism", () => {
  it("is recognized as a supported Aura", () => {
    expect(getSpellEffect(PACIFISM)).toEqual({ kind: "pacify" });
  });

  it("enters attached to its target, and that creature can't attack", () => {
    let { g, me, pacifism, myBear } = setup();
    g = resolveAll(unwrap(cast(g, me, pacifism, myBear)));

    const aura = getPlayer(g, me).battlefield.find((c) => c.card.name === "Pacifism")!;
    expect(aura.attachedTo).toBe(myBear);
    expect(pacifiedIds(g).has(myBear)).toBe(true);
    expect(eligibleAttackers(g).map((c) => c.instanceId)).not.toContain(myBear);

    g = passUntil(g, (s) => s.awaiting === "attackers" || s.phase === "main2");
    const attack = processCommand(g, { type: "DECLARE_ATTACKERS", playerId: me, attackerIds: [myBear] });
    expect(attack.ok).toBe(false);
  });

  it("stops the enchanted creature from blocking", () => {
    let { g, me, pacifism, myBear, theirBear } = setup();
    g = resolveAll(unwrap(cast(g, me, pacifism, theirBear)));

    g = passUntil(g, (s) => s.awaiting === "attackers");
    g = unwrap(processCommand(g, { type: "DECLARE_ATTACKERS", playerId: me, attackerIds: [myBear] }));
    expect(eligibleBlockers(g).map((c) => c.instanceId)).not.toContain(theirBear);
  });

  it("can only target a creature, not a player", () => {
    const { g, me, opp, pacifism } = setup();
    const result = processCommand(g, {
      type: "CAST_SPELL",
      playerId: me,
      cardInstanceId: pacifism,
      targets: [{ kind: "player", playerId: opp }],
    });
    expect(result.ok).toBe(false);
  });

  it("is cast at sorcery speed only (not while something is on the stack)", () => {
    let { g, me, pacifism, myBear, theirBear } = setup();
    g = addPermanent(g, me, PLAINS).state;
    g = addPermanent(g, me, PLAINS).state;
    const second = addToHand(g, me, PACIFISM);
    g = unwrap(cast(second.state, me, pacifism, theirBear)); // first one on the stack
    const again = cast(g, me, second.instanceId, myBear);
    expect(again.ok).toBe(false);
  });

  it("goes to the graveyard when its creature leaves", () => {
    let { g, me, pacifism, theirBear } = setup();
    g = resolveAll(unwrap(cast(g, me, pacifism, theirBear)));
    g = applyStateBasedActions(destroyPermanent(g, theirBear));

    expect(getPlayer(g, me).battlefield.some((c) => c.card.name === "Pacifism")).toBe(false);
    expect(getPlayer(g, me).graveyard.map((c) => c.card.name)).toContain("Pacifism");
  });

  it("fizzles to the graveyard if its target is gone before it resolves", () => {
    let { g, me, pacifism, theirBear } = setup();
    g = unwrap(cast(g, me, pacifism, theirBear));
    g = destroyPermanent(g, theirBear); // removed in response
    g = resolveAll(g);

    expect(getPlayer(g, me).battlefield.some((c) => c.card.name === "Pacifism")).toBe(false);
    expect(getPlayer(g, me).graveyard.map((c) => c.card.name)).toContain("Pacifism");
  });
});