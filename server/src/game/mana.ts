/**
 * mana.ts
 *
 * Everything about paying for spells:
 *   - parseManaCost: turns "{2}{R}" into generic + colored requirements
 *   - getManaAbility: what mana a permanent makes when tapped, read from
 *     the card's oracle text ("{T}: Add {G}.")
 *   - planPayment: picks which permanents to tap to pay a cost
 *
 * Simplification for v1: payment is automatic, like Arena's auto-tap. The
 * engine chooses which permanents to tap when a spell is cast, so there's
 * no separate "tap for mana" step and Player.manaPool stays unused. Mana
 * abilities don't use the stack in real Magic, which fits this approach.
 *
 * Supported: generic ({2}) and colored ({W}{U}{B}{R}{G}{C}) costs, and
 * permanents with a single "{T}: Add {X}." ability. Not supported yet:
 * {X}, hybrid, and Phyrexian costs, and multi-color or conditional mana.
 */

import type { BattlefieldCard, Card } from "../../../shared/src/types";

export type ManaSymbol = "W" | "U" | "B" | "R" | "G" | "C";

const SYMBOLS: readonly ManaSymbol[] = ["W", "U", "B", "R", "G", "C"];

export type ParsedCost = {
  generic: number;
  colored: Record<ManaSymbol, number>;
};

/** Returns null if the cost uses a symbol we don't support yet. */
export function parseManaCost(cost: string): ParsedCost | null {
  const parsed: ParsedCost = {
    generic: 0,
    colored: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  };

  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1];
    if (/^\d+$/.test(symbol)) {
      parsed.generic += parseInt(symbol, 10);
    } else if ((SYMBOLS as readonly string[]).includes(symbol)) {
      parsed.colored[symbol as ManaSymbol] += 1;
    } else {
      return null;
    }
  }
  return parsed;
}

/**
 * The mana this card makes when tapped, or null if it doesn't make any.
 * Basic lands' oracle text is the reminder "({T}: Add {W}.)", so any
 * wrapping parentheses are removed first.
 */
export function getManaAbility(card: Card): ManaSymbol | null {
  const text = card.oracleText.trim().replace(/^\((.*)\)$/s, "$1").trim();
  const match = /^\{T\}: Add \{([WUBRGC])\}\.?$/.exec(text);
  return match ? (match[1] as ManaSymbol) : null;
}

type ManaSource = { id: string; color: ManaSymbol; isCreature: boolean };

/** A permanent can be tapped for mana if it's untapped and not summoning sick. */
function toManaSource(permanent: BattlefieldCard): ManaSource | null {
  if (permanent.tapped) return null;
  const color = getManaAbility(permanent.card);
  if (color === null) return null;

  const isCreature = permanent.card.types.includes("Creature");
  if (isCreature && permanent.summoningSick) return null; // {T} abilities need no summoning sickness

  return { id: permanent.instanceId, color, isCreature };
}

/**
 * Chooses which permanents to tap to pay `cost`, or returns null if the
 * player can't afford it. Colored requirements are filled first, then
 * generic ones. Lands are always preferred over mana creatures, so
 * creatures stay untapped to attack or block.
 *
 * Greedy is optimal here because every source makes exactly one fixed color.
 */
export function planPayment(
  battlefield: readonly BattlefieldCard[],
  cost: ParsedCost
): string[] | null {
  const sources = battlefield
    .map(toManaSource)
    .filter((s): s is ManaSource => s !== null)
    .sort((a, b) => Number(a.isCreature) - Number(b.isCreature)); // lands first

  const used = new Set<string>();
  const take = (matches: (s: ManaSource) => boolean): boolean => {
    const source = sources.find((s) => !used.has(s.id) && matches(s));
    if (!source) return false;
    used.add(source.id);
    return true;
  };

  for (const symbol of SYMBOLS) {
    for (let i = 0; i < cost.colored[symbol]; i++) {
      if (!take((s) => s.color === symbol)) return null;
    }
  }
  for (let i = 0; i < cost.generic; i++) {
    if (!take(() => true)) return null;
  }

  return Array.from(used);
}