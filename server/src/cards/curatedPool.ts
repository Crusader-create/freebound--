/**
 * curatedPool.ts
 *
 * The cards Freebound's rules engine supports. Imported decks may only
 * contain cards from this list.
 *
 * Every card here was selected from the real Scryfall cache using
 * `npm run pool-candidates --workspace=server`, and each was Standard-legal
 * at the time of selection. Confirm with:
 *
 *   npm run audit-pool --workspace=server
 *
 * Design rule: legendary cards are excluded so the engine never needs the
 * legend rule. Tiered/modal spells, cost reducers, and conditional casting
 * are excluded too.
 *
 * What the engine must support for this pool (the real to-do list):
 *   Keywords:  flying, first strike, lifelink, haste, reach, trample,
 *              vigilance, deathtouch, defender
 *   Spells:    damage to a target, +X/+X until end of turn, -X/-X until end
 *              of turn, destroy target creature, destroy attacking/blocking
 *              creature
 *   Other:     mana ability ({T}: Add {G}), Aura that stops attacking and
 *              blocking (Pacifism)
 *   ETB:       draw a card, gain life, 1 damage to any target,
 *              create a creature token
 *
 * Tokens (Prideful Parent, Elder Auntie) are the most work of the ETB
 * cards. If time gets tight, drop those two; the other three ETB cards
 * still satisfy the "at least 3 ETB triggers" requirement.
 */

export const CURATED_POOL_NAMES: readonly string[] = [
  // Basic lands
  "Plains",
  "Mountain",
  "Forest",
  "Swamp",

  // ---------- White (aggro) ----------
  "Healer's Hawk",
  "Savannah Lions",
  "Bishop's Soldier",
  "Brightblade Stoat",
  "Leonin Skyhunter",
  "Serra Angel",
  "Helpful Hunter", // ETB: draw a card
  "Prideful Parent", // ETB: create a token
  "Sudden Strike",
  "Pacifism",

  // ---------- Red (burn / beatdown) ----------
  "Swab Goblin",
  "Brazen Scourge",
  "Skyraker Giant",
  "Fire Elemental",
  "Quaketusk Boar",
  "Rearing Embermare",
  "Elder Auntie", // ETB: create a token
  "Shock",
  "Lightning Strike",
  "Sear",
  "Bombard",
  "Scorching Shot",
  "Flame Lash",

  // ---------- Green (ramp / stompy) ----------
  "Llanowar Elves",
  "Druid of the Cowl",
  "Ankle Biter",
  "Dragon Sniper",
  "Bear Cub",
  "Jibbirik Omnivore",
  "Thornweald Archer",
  "Colossadactyl",
  "Magnigoth Sentry",
  "Ordinary Bear",
  "Tajuru Pathwarden",
  "Primordial Pachyderm", // ETB: gain 2 life
  "Giant Growth",
  "Titanic Growth",

  // ---------- Black (removal) ----------
  "Hullcarver",
  "Squirrelanoids",
  "Monoist Sentry",
  "Vampire Nighthawk",
  "Highborn Vampire",
  "Skeleton Archer", // ETB: 1 damage to any target
  "Stab",
  "Dark Deed",
  "Last Gasp",
  "Fell",
  "Murder",
  "Overkill",
];

const POOL_LOOKUP = new Set(CURATED_POOL_NAMES.map((n) => n.toLowerCase()));

/** Case-insensitive membership check. */
export function isInCuratedPool(cardName: string): boolean {
  return POOL_LOOKUP.has(cardName.toLowerCase());
}