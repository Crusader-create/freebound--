/**
 * deckParser.ts
 *
 * Parses pasted decklist text into a list of {count, name} entries.
 * Supports:
 *   - Plain MTGO/Arena format:      "4 Lightning Bolt"
 *   - Archidekt's "x" format:       "4x Lightning Bolt"
 *   - Set/collector-number suffix:  "1 Fable of the Mirror-Breaker (MID) 143"
 *   - Archidekt category headers:   "Creature (12)"  (ignored, not parsed as a card)
 *   - A "Sideboard" section header, splitting main deck from sideboard
 *
 * This module does NOT look up cards against Scryfall data or check
 * legality — it only turns raw text into clean {count, name} pairs.
 * Legality/curated-pool validation is a separate step (see the card
 * importer) that takes this module's output as input.
 */

export type DecklistEntry = {
  count: number;
  name: string;
};

export type ParsedDecklist = {
  mainDeck: DecklistEntry[];
  sideboard: DecklistEntry[];
};

// Matches "Sideboard", "Sideboard:", case-insensitive, on its own line.
const SIDEBOARD_HEADER = /^sideboard:?$/i;

// Matches Archidekt-style category headers like "Creature (12)" or
// "Instant / Sorcery (8)" — a line that does NOT start with a digit and
// ends with a parenthesized number. These get skipped, not parsed as cards.
const CATEGORY_HEADER = /^[^\d].*\(\d+\)\s*$/;

// Matches a count + name line, with an optional "x" after the count:
// "4 Lightning Bolt"  or  "4x Lightning Bolt"
const COUNT_LINE = /^(\d+)x?\s+(.+)$/i;

// Strips a trailing set code + collector number, e.g. turns
// "Fable of the Mirror-Breaker (MID) 143" into "Fable of the Mirror-Breaker".
// Set codes are 2-5 uppercase letters/digits in parens, optionally followed
// by a collector number (which may include letters, e.g. "143a").
const SET_SUFFIX = /\s*\([A-Z0-9]{2,5}\)\s*[A-Za-z0-9]*\s*$/;

function stripSetSuffix(name: string): string {
  return name.replace(SET_SUFFIX, "").trim();
}

export function parseDecklist(rawText: string): ParsedDecklist {
  const mainDeck: DecklistEntry[] = [];
  const sideboard: DecklistEntry[] = [];

  let inSideboard = false;

  const lines = rawText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Blank lines don't switch sections on their own — only an explicit
    // "Sideboard" header does. This matches how Moxfield/Archidekt exports
    // actually look (a blank line often just separates category groups
    // within the main deck, not main deck from sideboard).
    if (line.length === 0) continue;

    if (SIDEBOARD_HEADER.test(line)) {
      inSideboard = true;
      continue;
    }

    if (CATEGORY_HEADER.test(line)) {
      continue;
    }

    const match = COUNT_LINE.exec(line);
    if (!match) {
      // Line didn't match any known pattern — skip it rather than throw,
      // so one weird line (e.g. a stray comment) doesn't kill the whole
      // import. The caller can diff input vs. output line counts if it
      // wants to surface "N lines were skipped" to the user.
      continue;
    }

    const count = parseInt(match[1], 10);
    const name = stripSetSuffix(match[2].trim());

    if (!name) continue;

    const entry: DecklistEntry = { count, name };
    (inSideboard ? sideboard : mainDeck).push(entry);
  }

  return { mainDeck, sideboard };
}

/**
 * Example usage / manual smoke test — not a real test suite, just a quick
 * way to sanity-check the parser. Run with: npx tsx shared/src/deckParser.ts
 */
import { fileURLToPath } from "url";

const isRunDirectly = process.argv[1] === fileURLToPath(import.meta.url);

if (isRunDirectly) {
  const sample = `
Creature (12)
4 Monastery Swiftspear
4x Goblin Guide
4 Ash Zealot

Instant (8)
4 Lightning Bolt
4 Shock

1 Fable of the Mirror-Breaker (MID) 143

Sideboard
2 Abrade
1 Smash to Smithereens
`;

  const result = parseDecklist(sample);
  console.log("Main deck:", result.mainDeck);
  console.log("Sideboard:", result.sideboard);
}