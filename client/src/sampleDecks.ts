/**
 * sampleDecks.ts
 *
 * One ready-made 60-card deck per archetype, written in the same plain-text
 * format players paste in. Used to (1) check that the validator accepts a
 * legal list and (2) play-test the full game later.
 *
 * Every deck: 60 cards, max 4 copies of any non-basic card.
 */

export const SAMPLE_DECKS: Record<string, string> = {
  "White Aggro": `
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

  "Red Burn": `
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

  "Green Ramp": `
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

  "Black Removal": `
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
};