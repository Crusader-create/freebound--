/**
 * pool-candidates.ts (v2)
 *
 * Scans the real card cache for Standard-legal cards simple enough for
 * Freebound's rules engine, grouped by color, so the curated pool can be
 * picked from cards that actually exist and are legal.
 *
 * Sections per color:
 *   - Creatures: vanilla, or ONLY keywords we plan to support
 *   - ETB creatures: keywords plus ONE simple "when this enters" effect
 *   - Mana creatures: "{T}: Add {X}."
 *   - Spells: instants/sorceries matching basic burn / pump / destroy patterns
 *
 * Cards whose rules text is ONLY reminder text (in parentheses) are flagged
 * with [CHECK TEXT] so a hidden ability can't sneak in as a "vanilla" card.
 *
 * Run:  npm run pool-candidates --workspace=server
 * Output is printed AND written to server/data/pool-candidates.txt
 */

import { writeFileSync } from "fs";
import { join } from "path";
import { loadCardCache } from "../cards/cardCache";
import type { CachedCard } from "../../../shared/src/types";

const KEYWORDS = new Set([
  "flying",
  "first strike",
  "trample",
  "deathtouch",
  "lifelink",
  "haste",
  "vigilance",
  "reach",
  "menace",
  "defender",
]);

const COLORS: ReadonlyArray<[string, string]> = [
  ["W", "White"],
  ["R", "Red"],
  ["G", "Green"],
  ["B", "Black"],
];

const MAX_MANA_VALUE = 5;
const PER_GROUP = 25;

const SPELL_PATTERNS: RegExp[] = [
  /^.+ deals \d+ damage to (any target|target creature|target player or planeswalker|target creature or planeswalker)\.?$/i,
  /^target creature gets [+-]\d+\/[+-]\d+ until end of turn\.?$/i,
  /^destroy target [\w -]*creature\.?$/i,
];

// Effects allowed after "When this creature enters, ..."
const ETB_EFFECT_PATTERNS: RegExp[] = [
  /^you gain \d+ life\.?$/i,
  /^draw a card\.?$/i,
  /^.+ deals \d+ damage to any target\.?$/i,
  /^create an? \d+\/\d+ [^.]*token[^.]*\.?$/i,
  /^destroy target [\w -]*creature\.?$/i,
  /^target creature gets [+-]\d+\/[+-]\d+ until end of turn\.?$/i,
];

const ETB_LINE = /^when .+ enters( the battlefield)?, (.+)$/i;
const MANA_LINE = /^\{T\}: add \{[WUBRGC]\}\.?$/i;

function stripReminder(text: string): string {
  return text.replace(/\([^)]*\)/g, "").trim();
}

function manaValue(cost: string): number {
  let total = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (/^\d+$/.test(sym)) total += parseInt(sym, 10);
    else if (sym !== "X") total += 1;
  }
  return total;
}

/** Returns the single color letter of a mono-colored cost, else null. */
function monoColor(cost: string): string | null {
  if (!cost || cost.includes("/")) return null;
  const colors = new Set<string>();
  for (const m of cost.matchAll(/\{([WUBRG])\}/g)) colors.add(m[1]);
  return colors.size === 1 ? Array.from(colors)[0] : null;
}

function textLines(card: CachedCard): string[] {
  return stripReminder(card.oracleText)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function isKeywordLine(line: string): boolean {
  return line.split(/,\s*/).every((p) => KEYWORDS.has(p.trim().toLowerCase()));
}

function isCreature(card: CachedCard): boolean {
  return (
    card.types.includes("Creature") &&
    card.power !== undefined &&
    card.toughness !== undefined
  );
}

function isSimpleCreature(card: CachedCard): boolean {
  return isCreature(card) && textLines(card).every(isKeywordLine);
}

function isEtbCreature(card: CachedCard): boolean {
  if (!isCreature(card)) return false;
  const lines = textLines(card).map((l) => l.replace(/\s+/g, " "));
  const etbLines = lines.filter((l) => ETB_LINE.test(l));
  const otherLines = lines.filter((l) => !ETB_LINE.test(l));
  if (etbLines.length !== 1 || !otherLines.every(isKeywordLine)) return false;
  const effect = ETB_LINE.exec(etbLines[0])![2];
  return ETB_EFFECT_PATTERNS.some((p) => p.test(effect));
}

function isManaCreature(card: CachedCard): boolean {
  if (!isCreature(card)) return false;
  const lines = textLines(card);
  return lines.length === 1 && MANA_LINE.test(lines[0]);
}

function isSimpleSpell(card: CachedCard): boolean {
  if (!card.types.includes("Instant") && !card.types.includes("Sorcery")) return false;
  const text = stripReminder(card.oracleText).replace(/\s+/g, " ");
  return SPELL_PATTERNS.some((p) => p.test(text));
}

function describe(card: CachedCard): string {
  const pt = card.power !== undefined ? `  ${card.power}/${card.toughness}` : "";
  const stripped = stripReminder(card.oracleText).replace(/\n/g, " / ");
  const flag =
    stripped === "" && card.oracleText.trim() !== ""
      ? `  [CHECK TEXT: ${card.oracleText.replace(/\n/g, " / ")}]`
      : "";
  return `${card.name}  ${card.manaCost}${pt}  ${stripped}${flag}`.trimEnd();
}

const byCost = (a: CachedCard, b: CachedCard) =>
  manaValue(a.manaCost) - manaValue(b.manaCost) || a.name.localeCompare(b.name);

const cache = loadCardCache();
const seen = new Set<string>();
const legal: CachedCard[] = [];
for (const card of cache.values()) {
  if (seen.has(card.scryfallId)) continue;
  seen.add(card.scryfallId);
  if (!card.standardLegal) continue;
  if (card.name.includes("//") || card.name.startsWith("A-")) continue;
  if (manaValue(card.manaCost) > MAX_MANA_VALUE) continue;
  legal.push(card);
}

const lines: string[] = [];
function out(line = "") {
  console.log(line);
  lines.push(line);
}

function section(title: string, cards: CachedCard[]) {
  out(`-- ${title} (${cards.length} found, showing up to ${PER_GROUP}) --`);
  cards.slice(0, PER_GROUP).forEach((c) => out(describe(c)));
}

for (const [letter, label] of COLORS) {
  const ofColor = legal.filter((c) => monoColor(c.manaCost) === letter);
  out(`===== ${label.toUpperCase()} =====`);
  section("Creatures (vanilla / keywords only)", ofColor.filter(isSimpleCreature).sort(byCost));
  section("ETB creatures", ofColor.filter(isEtbCreature).sort(byCost));
  section("Mana creatures", ofColor.filter(isManaCreature).sort(byCost));
  section("Spells", ofColor.filter(isSimpleSpell).sort(byCost));
  out();
}

const outPath = join(process.cwd(), "data", "pool-candidates.txt");
writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(`\nAlso written to ${outPath}`);