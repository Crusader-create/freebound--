/**
 * validateDeck.ts
 *
 * Takes the output of parseDecklist() and checks it against the card cache:
 *   1. Every card name exists
 *   2. Every card is Standard-legal
 *   3. Every card is in Freebound's curated pool (i.e. actually implemented)
 *   4. No more than 4 copies of a non-basic card
 *   5. At least 60 cards in the main deck
 *
 * It collects ALL problems instead of stopping at the first one, so a player
 * can fix their whole list in one go. It never throws on bad input.
 *
 * Sideboards are ignored for now (sideboarding is out of scope for the MVP).
 */

import type { ParsedDecklist } from "../../../shared/src/deckParser";
import type { CachedCard } from "../../../shared/src/types";
import type { CardCache } from "./cardCache";
import { isInCuratedPool } from "./curatedPool";

export const MIN_DECK_SIZE = 60;
export const MAX_COPIES = 4;

export type DeckErrorCode =
  | "UNKNOWN_CARD"
  | "NOT_STANDARD_LEGAL"
  | "NOT_IMPLEMENTED"
  | "TOO_MANY_COPIES"
  | "DECK_TOO_SMALL";

export type DeckError = {
  code: DeckErrorCode;
  cardName?: string;
  message: string;
};

export type ValidatedCard = { card: CachedCard; count: number };

export type ValidationResult =
  | { ok: true; cards: ValidatedCard[]; warnings: string[] }
  | { ok: false; errors: DeckError[]; warnings: string[] };

export function validateDeck(
  parsed: ParsedDecklist,
  cache: CardCache
): ValidationResult {
  const errors: DeckError[] = [];
  const warnings: string[] = [];

  // Resolve every line to a real card, merging duplicate lines for the
  // same card (e.g. "2 Shock" appearing twice).
  const resolved = new Map<string, ValidatedCard>();
  const reportedUnknown = new Set<string>();
  let totalCards = 0;

  for (const entry of parsed.mainDeck) {
    totalCards += entry.count;

    const card = cache.get(entry.name.toLowerCase());
    if (!card) {
      const key = entry.name.toLowerCase();
      if (!reportedUnknown.has(key)) {
        reportedUnknown.add(key);
        errors.push({
          code: "UNKNOWN_CARD",
          cardName: entry.name,
          message: `"${entry.name}" wasn't found. Check the spelling.`,
        });
      }
      continue;
    }

    const existing = resolved.get(card.scryfallId);
    if (existing) {
      existing.count += entry.count;
    } else {
      resolved.set(card.scryfallId, { card, count: entry.count });
    }
  }

  // Per-card checks.
  for (const { card, count } of resolved.values()) {
    if (!card.standardLegal) {
      errors.push({
        code: "NOT_STANDARD_LEGAL",
        cardName: card.name,
        message: `"${card.name}" isn't legal in Standard.`,
      });
    }

    if (!isInCuratedPool(card.name)) {
      errors.push({
        code: "NOT_IMPLEMENTED",
        cardName: card.name,
        message: `"${card.name}" isn't supported in Freebound yet.`,
      });
    }

    const isBasicLand = card.types.includes("Basic");
    if (!isBasicLand && count > MAX_COPIES) {
      errors.push({
        code: "TOO_MANY_COPIES",
        cardName: card.name,
        message: `"${card.name}": ${count} copies, but the limit is ${MAX_COPIES}.`,
      });
    }
  }

  // Deck size.
  if (totalCards < MIN_DECK_SIZE) {
    errors.push({
      code: "DECK_TOO_SMALL",
      message: `Main deck has ${totalCards} cards; the minimum is ${MIN_DECK_SIZE}.`,
    });
  }

  if (parsed.sideboard.length > 0) {
    warnings.push("Sideboards aren't supported yet, so yours was ignored.");
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, cards: Array.from(resolved.values()), warnings };
}