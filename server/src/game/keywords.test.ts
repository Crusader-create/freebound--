import { describe, expect, it } from "vitest";
import { getKeywords, hasKeyword } from "./keywords";
import { fakeCard } from "./testHelpers";

function card(oracleText: string) {
  return fakeCard("Some Creature", ["Creature"], { oracleText });
}

// The oracle texts below are copied from real cards in the scan.
describe("getKeywords", () => {
  it("reads keywords on separate lines (Healer's Hawk)", () => {
    const keywords = getKeywords(card("Flying\nLifelink"));
    expect(keywords).toEqual(new Set(["flying", "lifelink"]));
  });

  it("reads several keywords on one line (Quaketusk Boar)", () => {
    const keywords = getKeywords(card("Reach, trample, haste"));
    expect(keywords).toEqual(new Set(["reach", "trample", "haste"]));
  });

  it("reads two-word keywords (Brightblade Stoat)", () => {
    const keywords = getKeywords(card("First strike, lifelink"));
    expect(keywords).toEqual(new Set(["first strike", "lifelink"]));
  });

  it("reads the full set on a mixed card (Vampire Nighthawk)", () => {
    const keywords = getKeywords(card("Flying\nDeathtouch\nLifelink"));
    expect(keywords).toEqual(new Set(["flying", "deathtouch", "lifelink"]));
  });

  it("reads defender and vigilance", () => {
    expect(hasKeyword(card("Defender"), "defender")).toBe(true);
    expect(hasKeyword(card("Vigilance\nTrample"), "vigilance")).toBe(true);
  });

  it("is case-insensitive and ignores reminder text", () => {
    const flying = card(
      "Flying (This creature can't be blocked except by creatures with flying or reach.)"
    );
    expect(hasKeyword(flying, "flying")).toBe(true);
  });

  it("finds nothing on a vanilla creature", () => {
    expect(getKeywords(card("")).size).toBe(0);
  });

  it("ignores abilities that aren't keywords (Prideful Parent)", () => {
    const parent = card(
      "Vigilance\nWhen this creature enters, create a 1/1 white Cat creature token."
    );
    expect(getKeywords(parent)).toEqual(new Set(["vigilance"]));
  });

  it("doesn't mistake a mana ability or trigger for a keyword", () => {
    expect(getKeywords(card("{T}: Add {G}.")).size).toBe(0);
    expect(getKeywords(card("When this creature enters, draw a card.")).size).toBe(0);
  });

  it("doesn't count a mixed line unless every part is a keyword", () => {
    // "Flying, whenever ..." has a non-keyword part, so the line is skipped.
    expect(hasKeyword(card("Flying, whenever this attacks, draw a card."), "flying")).toBe(false);
  });
});