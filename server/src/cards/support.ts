/**
 * support.ts
 *
 * Does the game engine fully understand this card? Used in three places
 * so the curated pool can never promise more than the engine does:
 *   - validateDeck rejects unsupported cards at import, with the reason
 *   - the lobby's "Cards you can use" list leaves them out
 *   - poolSupport.test.ts checks every pool card against the real cache
 *
 * A card is supported when every line of its rules text is something the
 * engine acts on: a keyword line, an "enters" trigger, a mana ability, a
 * spell effect, or a Pacifism-style Aura. Text the engine would silently
 * ignore counts as unsupported, because the card wouldn't play as written.
 */

import type { Card } from "../../../shared/src/types";
import { getSpellEffect } from "../game/effects";
import { getKeywords } from "../game/keywords";
import { getManaAbility } from "../game/mana";
import { getEtbTrigger } from "../game/triggers";

/** Why the engine can't play this card as written, or null if it can. */
export function supportProblem(card: Card): string | null {
  const types = card.types;
  if (types.includes("Land")) {
    return getManaAbility(card) ? null : "only basic lands are supported";
  }

  if (types.includes("Instant") || types.includes("Sorcery")) {
    return getSpellEffect(card) ? null : "its spell effect isn't supported yet";
  }

  if (types.includes("Enchantment") && !types.includes("Creature")) {
    return getSpellEffect(card)?.kind === "pacify"
      ? null
      : "only Pacifism-style enchantments are supported so far";
  }

  if (!types.includes("Creature")) {
    return `${types.filter((t) => t !== "Legendary").join(" ")} cards aren't supported yet`;
  }

  // A creature: every rules line must be understood.
  const keywords = getKeywords(card);
  const lines = card.oracleText
    .replace(/\([^)]*\)/g, "") // reminder text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^when .+? enters/i.test(line)) {
      if (getEtbTrigger(card)) continue;
      return `its ability "${line}" isn't supported yet`;
    }
    if (/^\{T\}: Add /.test(line)) {
      if (getManaAbility(card)) continue;
      return `its ability "${line}" isn't supported yet`;
    }
    const parts = line.split(/,\s*/).map((part) => part.toLowerCase());
    if (parts.every((part) => (keywords as Set<string>).has(part))) continue;
    return `its ability "${line}" isn't supported yet`;
  }
  return null;
}