/**
 * sampleDecks.test.ts
 *
 * Every sample deck in the lobby must be accepted by the same deck rules
 * players face, so picking one never ends in an error message. Also checks
 * that each deck's listed colors match the cards in it (the lobby's pips
 * and color filter rely on that).
 *
 * Uses the real card cache in server/data/card-cache.json (from
 * `npm run fetch-cards --workspace=server`).
 */

import { describe, expect, it } from "vitest";
import { parseDecklist } from "../../../shared/src/deckParser";
import { SAMPLE_DECKS, type DeckColor } from "../../../shared/src/sampleDecks";
import { loadCardCache } from "./cardCache";
import { validateDeck } from "./validateDeck";

const cache = loadCardCache();

const BASIC_COLOR: Record<string, DeckColor> = {
  Plains: "W",
  Mountain: "R",
  Forest: "G",
  Swamp: "B",
};

/** The colored mana symbols in a cost like "{1}{W}{W}". */
function costColors(manaCost: string): DeckColor[] {
  return (manaCost.match(/\{([WRGB])\}/g) ?? []).map((sym) => sym[1] as DeckColor);
}

describe("sample decks", () => {
  it("have unique names", () => {
    const names = SAMPLE_DECKS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const deck of SAMPLE_DECKS) {
    describe(deck.name, () => {
      const parsed = parseDecklist(deck.list);
      const result = validateDeck(parsed, cache);

      it("passes deck validation", () => {
        if (!result.ok) {
          throw new Error(result.errors.map((e) => e.message).join("\n"));
        }
        expect(result.ok).toBe(true);
      });

      it("only uses its listed colors, and has lands for each of them", () => {
        if (!result.ok) return; // reported by the test above
        const used = new Set<DeckColor>();
        const landColors = new Set<DeckColor>();
        for (const { card } of result.cards) {
          costColors(card.manaCost).forEach((c) => used.add(c));
          const basic = BASIC_COLOR[card.name];
          if (basic) landColors.add(basic);
        }
        expect([...used].sort()).toEqual([...deck.colors].sort());
        expect([...landColors].sort()).toEqual([...deck.colors].sort());
      });
    });
  }
});