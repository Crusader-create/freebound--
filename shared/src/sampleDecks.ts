/**
 * sampleDecks.ts
 *
 * Ready-made 60-card decks, written in the same plain-text format players
 * paste in. The lobby's deck browser lists these, and a server test
 * (sampleDecks.test.ts) checks every one against the deck rules, so a
 * typo or an unsupported card fails the tests instead of the lobby.
 *
 * Rules for adding a deck:
 *   - only cards from server/src/cards/curatedPool.ts
 *   - at least 60 cards, at most 4 copies of anything but basic lands
 *   - `colors` lists the deck's colors in WRGB order (used for the pips
 *     and the color filter)
 */

export type DeckColor = "W" | "R" | "G" | "B";

export type SampleDeck = {
  name: string;
  colors: DeckColor[];
  description: string; // one line: how the deck wins
  list: string;
};

export const SAMPLE_DECKS: SampleDeck[] = [
  // ---------- one color ----------
  {
    name: "White Aggro",
    colors: ["W"],
    description: "Cheap creatures early, lifelink to stay ahead, Serra Angel to finish.",
    list: `
4 Healer's Hawk
4 Savannah Lions
4 Bishop's Soldier
4 Brightblade Stoat
4 Leonin Skyhunter
4 Helpful Hunter
4 Prideful Parent
4 Sudden Strike
3 Serra Angel
3 Pacifism
22 Plains
`,
  },
  {
    name: "White Skies",
    colors: ["W"],
    description: "Win in the air with flyers while Pacifism holds back their best attacker.",
    list: `
4 Healer's Hawk
4 Leonin Skyhunter
4 Brightblade Stoat
4 Bishop's Soldier
4 Helpful Hunter
4 Prideful Parent
4 Serra Angel
4 Pacifism
4 Sudden Strike
24 Plains
`,
  },
  {
    name: "Red Burn",
    colors: ["R"],
    description: "Fast hasty threats backed by burn that can hit creatures or face.",
    list: `
4 Swab Goblin
4 Brazen Scourge
4 Elder Auntie
4 Skyraker Giant
3 Fire Elemental
3 Quaketusk Boar
2 Rearing Embermare
4 Shock
4 Lightning Strike
3 Sear
3 Bombard
22 Mountain
`,
  },
  {
    name: "Red Giants",
    colors: ["R"],
    description: "Clear the way with removal, then slam five-drops with haste and trample.",
    list: `
4 Swab Goblin
4 Brazen Scourge
4 Elder Auntie
4 Skyraker Giant
4 Fire Elemental
4 Quaketusk Boar
4 Rearing Embermare
4 Sear
4 Bombard
24 Mountain
`,
  },
  {
    name: "Green Ramp",
    colors: ["G"],
    description: "Mana creatures into big tramplers a turn or two ahead of schedule.",
    list: `
4 Llanowar Elves
4 Druid of the Cowl
4 Ankle Biter
4 Thornweald Archer
3 Bear Cub
4 Colossadactyl
3 Magnigoth Sentry
4 Primordial Pachyderm
3 Tajuru Pathwarden
3 Giant Growth
2 Titanic Growth
22 Forest
`,
  },
  {
    name: "Black Removal",
    colors: ["B"],
    description: "Kill everything they play and win with whatever's left standing.",
    list: `
4 Hullcarver
4 Squirrelanoids
4 Vampire Nighthawk
4 Highborn Vampire
4 Skeleton Archer
2 Monoist Sentry
4 Fell
4 Murder
3 Last Gasp
2 Dark Deed
2 Stab
1 Overkill
22 Swamp
`,
  },

  // ---------- two colors ----------
  {
    name: "Boros Blitz",
    colors: ["W", "R"],
    description: "All-in aggro: one-drops, haste, and burn to finish the job.",
    list: `
4 Savannah Lions
4 Healer's Hawk
4 Swab Goblin
4 Brightblade Stoat
4 Brazen Scourge
4 Prideful Parent
4 Elder Auntie
4 Shock
4 Lightning Strike
2 Sudden Strike
11 Plains
11 Mountain
`,
  },
  {
    name: "Selesnya Pack",
    colors: ["W", "G"],
    description: "Go wide with creatures and tokens, then pump the one they don't block.",
    list: `
4 Llanowar Elves
4 Savannah Lions
4 Bishop's Soldier
4 Bear Cub
4 Prideful Parent
4 Magnigoth Sentry
3 Serra Angel
3 Tajuru Pathwarden
4 Giant Growth
3 Pacifism
12 Forest
11 Plains
`,
  },
  {
    name: "Orzhov Lifedrain",
    colors: ["W", "B"],
    description: "Lifelink creatures and hard removal make racing you nearly impossible.",
    list: `
4 Healer's Hawk
4 Bishop's Soldier
4 Brightblade Stoat
4 Vampire Nighthawk
4 Helpful Hunter
3 Serra Angel
3 Skeleton Archer
4 Murder
3 Fell
3 Pacifism
12 Plains
12 Swamp
`,
  },
  {
    name: "Gruul Stompers",
    colors: ["R", "G"],
    description: "Ramp into big trampling, hasty creatures and burn away any blockers.",
    list: `
4 Llanowar Elves
4 Druid of the Cowl
4 Bear Cub
4 Brazen Scourge
4 Colossadactyl
4 Quaketusk Boar
3 Tajuru Pathwarden
3 Lightning Strike
2 Shock
3 Titanic Growth
2 Bombard
12 Forest
11 Mountain
`,
  },
  {
    name: "Rakdos Raiders",
    colors: ["R", "B"],
    description: "Aggressive creatures plus burn and removal to keep the path clear.",
    list: `
4 Hullcarver
4 Swab Goblin
4 Brazen Scourge
4 Elder Auntie
4 Vampire Nighthawk
3 Skyraker Giant
4 Shock
4 Lightning Strike
3 Last Gasp
2 Murder
12 Mountain
12 Swamp
`,
  },
  {
    name: "Golgari Deathtouch",
    colors: ["G", "B"],
    description: "Deathtouch everywhere makes every block a trade they can't afford.",
    list: `
4 Ankle Biter
4 Hullcarver
4 Squirrelanoids
4 Thornweald Archer
4 Druid of the Cowl
4 Primordial Pachyderm
3 Highborn Vampire
3 Colossadactyl
4 Fell
3 Dark Deed
2 Giant Growth
11 Forest
10 Swamp
`,
  },
];