// Quick manual check for the decklist parser.
// Run from the project root:  npx tsx shared/src/deckParser.demo.ts
import { parseDecklist } from "./deckParser";

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