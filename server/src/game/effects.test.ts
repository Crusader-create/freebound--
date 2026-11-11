import { describe, expect, it } from "vitest";
import { getSpellEffect, isTarget } from "./effects";
import { fakeCard } from "./testHelpers";

/** Builds a card whose only interesting feature is its oracle text. */
function spell(oracleText: string) {
  return fakeCard("Some Spell", ["Instant"], { oracleText });
}

// The oracle texts below are copied from the real cards in the scan.
describe("getSpellEffect: supported effects", () => {
  it("reads damage to any target (Shock, Lightning Strike)", () => {
    expect(getSpellEffect(spell("Shock deals 2 damage to any target."))).toEqual({
      kind: "damage",
      amount: 2,
      target: "any",
    });
    expect(getSpellEffect(spell("Lightning Strike deals 3 damage to any target."))).toEqual({
      kind: "damage",
      amount: 3,
      target: "any",
    });
  });

  it("reads damage to a creature (Bombard, Scorching Shot)", () => {
    expect(getSpellEffect(spell("Bombard deals 4 damage to target creature."))).toEqual({
      kind: "damage",
      amount: 4,
      target: "creature",
    });
  });

  it("treats 'creature or planeswalker' as a creature target (Sear)", () => {
    expect(
      getSpellEffect(spell("Sear deals 4 damage to target creature or planeswalker."))
    ).toEqual({ kind: "damage", amount: 4, target: "creature" });
  });

  it("reads positive pump (Giant Growth, Titanic Growth)", () => {
    expect(
      getSpellEffect(spell("Target creature gets +3/+3 until end of turn."))
    ).toEqual({ kind: "pump", power: 3, toughness: 3 });
    expect(
      getSpellEffect(spell("Target creature gets +4/+4 until end of turn."))
    ).toEqual({ kind: "pump", power: 4, toughness: 4 });
  });

  it("reads negative pump (Stab, Dark Deed, Last Gasp)", () => {
    expect(
      getSpellEffect(spell("Target creature gets -2/-2 until end of turn."))
    ).toEqual({ kind: "pump", power: -2, toughness: -2 });
    expect(
      getSpellEffect(spell("Target creature gets -4/-4 until end of turn."))
    ).toEqual({ kind: "pump", power: -4, toughness: -4 });
  });

  it("reads -0/-9999 as no power change and -9999 toughness (Overkill)", () => {
    const effect = getSpellEffect(spell("Target creature gets -0/-9999 until end of turn."));
    expect(effect).toEqual({ kind: "pump", power: 0, toughness: -9999 });
  });

  it("reads destroy target creature (Fell, Murder)", () => {
    expect(getSpellEffect(spell("Destroy target creature."))).toEqual({
      kind: "destroy",
      target: "creature",
    });
  });

  it("reads destroy attacking or blocking creature (Sudden Strike)", () => {
    expect(
      getSpellEffect(spell("Destroy target attacking or blocking creature."))
    ).toEqual({ kind: "destroy", target: "attacking_or_blocking_creature" });
  });

  it("ignores reminder text in parentheses", () => {
    expect(
      getSpellEffect(spell("Shock deals 2 damage to any target. (It hurts.)"))
    ).toEqual({ kind: "damage", amount: 2, target: "any" });
  });
});

describe("getSpellEffect: unsupported text returns null", () => {
  it("rejects color or type restrictions", () => {
    expect(getSpellEffect(spell("Destroy target green or white creature."))).toBeNull(); // Deathmark
    expect(getSpellEffect(spell("Destroy target non-outlaw creature."))).toBeNull(); // Shoot the Sheriff
  });

  it("rejects multi-sentence and conditional spells", () => {
    expect(
      getSpellEffect(
        spell(
          "This spell costs {3} less to cast if it targets a tapped creature.\nMagnificent End deals 5 damage to target creature."
        )
      )
    ).toBeNull();
  });

  it("rejects modal and tiered spells", () => {
    expect(
      getSpellEffect(
        spell(
          "Choose one —\n• Fulminous Forte deals 1 damage to each creature and planeswalker your opponents control.\n• Fulminous Forte deals 5 damage to target creature or planeswalker."
        )
      )
    ).toBeNull();
    expect(getSpellEffect(spell("Tiered\n• Thunder — {0} — Thunder Magic deals 2 damage to target creature."))).toBeNull();
  });

  it("rejects auras and plain creatures", () => {
    expect(
      getSpellEffect(spell("Enchant creature\nEnchanted creature can't attack or block."))
    ).toBeNull();
    expect(getSpellEffect(spell("Flying"))).toBeNull();
    expect(getSpellEffect(spell(""))).toBeNull();
  });
});

describe("isTarget", () => {
  it("accepts well-formed targets", () => {
    expect(isTarget({ kind: "player", playerId: "p1" })).toBe(true);
    expect(isTarget({ kind: "permanent", instanceId: "abc" })).toBe(true);
    expect(isTarget({ kind: "stack", stackId: "s1" })).toBe(true);
  });

  it("rejects malformed targets", () => {
    expect(isTarget(null)).toBe(false);
    expect(isTarget("player")).toBe(false);
    expect(isTarget({ kind: "player" })).toBe(false);
    expect(isTarget({ kind: "permanent", instanceId: 5 })).toBe(false);
    expect(isTarget({ kind: "nonsense", playerId: "p1" })).toBe(false);
  });
});