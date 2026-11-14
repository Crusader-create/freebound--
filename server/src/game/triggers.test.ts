import { describe, expect, it } from "vitest";
import { describeTrigger, getEtbTrigger, triggerNeedsTarget } from "./triggers";
import { fakeCard } from "./testHelpers";

function creature(oracleText: string) {
  return fakeCard("Some Creature", ["Creature"], { oracleText, power: 2, toughness: 2 });
}

// The oracle texts below are copied from the real cards in the pool.
describe("getEtbTrigger: the pool's triggers", () => {
  it("reads draw a card (Helpful Hunter)", () => {
    expect(getEtbTrigger(creature("When this creature enters, draw a card."))).toEqual({
      kind: "draw",
      count: 1,
    });
  });

  it("reads gain life, even after keyword lines (Primordial Pachyderm)", () => {
    const text = "Reach, trample\nWhen this creature enters, you gain 2 life.";
    expect(getEtbTrigger(creature(text))).toEqual({ kind: "gain_life", amount: 2 });
  });

  it("reads damage to any target (Skeleton Archer)", () => {
    expect(
      getEtbTrigger(creature("When this creature enters, it deals 1 damage to any target."))
    ).toEqual({ kind: "damage", amount: 1 });
  });

  it("reads a one-color token (Prideful Parent)", () => {
    const text = "Vigilance\nWhen this creature enters, create a 1/1 white Cat creature token.";
    expect(getEtbTrigger(creature(text))).toEqual({
      kind: "token",
      power: 1,
      toughness: 1,
      name: "Cat",
    });
  });

  it("reads a two-color token (Elder Auntie)", () => {
    const text = "When this creature enters, create a 1/1 black and red Goblin creature token.";
    expect(getEtbTrigger(creature(text))).toEqual({
      kind: "token",
      power: 1,
      toughness: 1,
      name: "Goblin",
    });
  });

  it("returns null for creatures with no trigger", () => {
    expect(getEtbTrigger(creature(""))).toBeNull();
    expect(getEtbTrigger(creature("Flying\nLifelink"))).toBeNull();
    expect(getEtbTrigger(creature("{T}: Add {G}."))).toBeNull();
  });

  it("returns null for ETB effects it doesn't understand", () => {
    // Boilerbilges Ripper: a "you may sacrifice" choice we don't support.
    const text =
      "When this creature enters, you may sacrifice another creature or enchantment. When you do, this creature deals 2 damage to any target.";
    expect(getEtbTrigger(creature(text))).toBeNull();
    // A token with an extra keyword we'd need to carry over.
    expect(
      getEtbTrigger(
        creature(
          "When this creature enters, create a 1/1 white and black Inkling creature token with flying."
        )
      )
    ).toBeNull();
  });
});

describe("triggerNeedsTarget / describeTrigger", () => {
  it("only the damage trigger needs a target", () => {
    expect(triggerNeedsTarget({ kind: "damage", amount: 1 })).toBe(true);
    expect(triggerNeedsTarget({ kind: "draw", count: 1 })).toBe(false);
    expect(triggerNeedsTarget({ kind: "gain_life", amount: 2 })).toBe(false);
    expect(triggerNeedsTarget({ kind: "token", power: 1, toughness: 1, name: "Cat" })).toBe(false);
  });

  it("describes each trigger for the UI", () => {
    const card = fakeCard("Prideful Parent", ["Creature"]);
    expect(describeTrigger(card, { kind: "token", power: 1, toughness: 1, name: "Cat" })).toBe(
      "Prideful Parent: create a 1/1 Cat token"
    );
    expect(describeTrigger(card, { kind: "draw", count: 1 })).toBe("Prideful Parent: draw a card");
  });
});