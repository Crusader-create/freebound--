/**
 * audit-pool.ts
 *
 * Checks every card in the curated pool against the real Scryfall cache and
 * reports: does the card exist, and is it Standard-legal? For legal cards it
 * also prints the real oracle text so you can compare it with what the pool
 * doc claimed.
 *
 * Run:  npm run audit-pool --workspace=server
 */

import { loadCardCache } from "../cards/cardCache";
import { CURATED_POOL_NAMES } from "../cards/curatedPool";

const cache = loadCardCache();

const notFound: string[] = [];
const notLegal: string[] = [];
const good: string[] = [];

for (const name of CURATED_POOL_NAMES) {
  const card = cache.get(name.toLowerCase());

  if (!card) {
    notFound.push(name);
    console.log(`NOT FOUND       ${name}`);
  } else if (!card.standardLegal) {
    notLegal.push(name);
    console.log(`NOT LEGAL       ${name}`);
  } else {
    good.push(name);
    const text = card.oracleText.replace(/\n/g, " / ");
    console.log(`OK              ${name}  ${card.manaCost}  ${card.types.join(" ")}`);
    console.log(`                ${text}`);
  }
}

console.log("\n----- SUMMARY -----");
console.log(`Total in pool:       ${CURATED_POOL_NAMES.length}`);
console.log(`Standard-legal:      ${good.length}`);
console.log(`Not Standard-legal:  ${notLegal.length}`);
console.log(`Not found at all:    ${notFound.length}`);

if (notFound.length > 0) {
  console.log("\nNot found (typo or not a real card):");
  notFound.forEach((n) => console.log(`  - ${n}`));
}
if (notLegal.length > 0) {
  console.log("\nReal cards, but not Standard-legal:");
  notLegal.forEach((n) => console.log(`  - ${n}`));
}