/**
 * keywords.ts
 *
 * Reads a card's keyword abilities from its oracle text. Keywords sit on
 * their own lines, sometimes several per line ("Reach, trample, haste"), and
 * may be followed by reminder text in parentheses. A line only counts as a
 * keyword line if EVERY part of it is a keyword we support, so an ability
 * like "When this creature enters, draw a card." is never misread.
 */

import type { Card } from "../../../shared/src/types";

export type Keyword =
  | "flying"
  | "first strike"
  | "trample"
  | "deathtouch"
  | "lifelink"
  | "haste"
  | "vigilance"
  | "reach"
  | "defender";

const SUPPORTED: ReadonlySet<string> = new Set([
  "flying",
  "first strike",
  "trample",
  "deathtouch",
  "lifelink",
  "haste",
  "vigilance",
  "reach",
  "defender",
]);

export function getKeywords(card: Card): Set<Keyword> {
  const text = card.oracleText.replace(/\([^)]*\)/g, ""); // drop reminder text
  const found = new Set<Keyword>();

  for (const line of text.split("\n")) {
    const parts = line
      .split(/,\s*/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    if (parts.length > 0 && parts.every((part) => SUPPORTED.has(part))) {
      for (const part of parts) found.add(part as Keyword);
    }
  }
  return found;
}

export function hasKeyword(card: Card, keyword: Keyword): boolean {
  return getKeywords(card).has(keyword);
}