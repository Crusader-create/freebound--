/**
 * validate-demo.ts
 *
 * Feeds a few deliberately bad decklists through the validator to confirm
 * it reports clear per-card errors instead of crashing.
 *
 * Run:  npm run validate-demo --workspace=server
 */

import { parseDecklist } from "../../../shared/src/deckParser";
import { loadCardCache } from "../cards/cardCache";
import { validateDeck } from "../cards/validateDeck";

const cache = loadCardCache();

const badDeck = `
4 Totally Fake Card
4 Black Lotus
7 Mountain
5 Lightning Bolt
Sideboard
2 Abrade
`;

const result = validateDeck(parseDecklist(badDeck), cache);

console.log("ok:", result.ok);
if (!result.ok) {
  for (const err of result.errors) {
    console.log(`  [${err.code}] ${err.message}`);
  }
}
for (const w of result.warnings) {
  console.log(`  (warning) ${w}`);
}