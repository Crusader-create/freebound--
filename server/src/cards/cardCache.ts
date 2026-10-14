/**
 * cardCache.ts
 *
 * Loads server/data/card-cache.json (written by fetch-cards.ts) into an
 * in-memory Map so deck validation never touches the network.
 *
 * Keys are lowercase card names. Double-faced cards are also indexed by
 * their front-face name, because decklists usually only list the front
 * ("Fable of the Mirror-Breaker", not the full "A // B" name).
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { CachedCard } from "../../../shared/src/types";

export type CardCache = Map<string, CachedCard>;

export function loadCardCache(
  path: string = join(process.cwd(), "data", "card-cache.json")
): CardCache {
  let cards: CachedCard[];
  try {
    cards = JSON.parse(readFileSync(path, "utf-8")) as CachedCard[];
  } catch (err) {
    throw new Error(
      `Could not read the card cache at ${path}. Run "npm run fetch-cards --workspace=server" first.`,
      { cause: err }
    );
  }

  const cache: CardCache = new Map();
  for (const card of cards) {
    cache.set(card.name.toLowerCase(), card);
  }

  // Second pass so full names always win over front-face aliases.
  for (const card of cards) {
    if (card.name.includes(" // ")) {
      const front = card.name.split(" // ")[0].toLowerCase();
      if (!cache.has(front)) cache.set(front, card);
    }
  }

  return cache;
}