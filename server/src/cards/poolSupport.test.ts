/**
 * poolSupport.test.ts
 *
 * Every card in the curated pool must be one the engine can actually play
 * as written (see support.ts). This runs against the real card cache, so
 * it catches cards whose real rules text has something the engine would
 * ignore.
 *
 * Needs server/data/card-cache.json (`npm run fetch-cards --workspace=server`).
 */

import { describe, expect, it } from "vitest";
import { loadCardCache } from "./cardCache";
import { CURATED_POOL_NAMES } from "./curatedPool";
import { supportProblem } from "./support";

const cache = loadCardCache();

describe("every curated pool card is playable", () => {
  for (const name of CURATED_POOL_NAMES) {
    it(name, () => {
      const card = cache.get(name.toLowerCase());
      if (!card) {
        throw new Error(`"${name}" isn't in the card cache. Run: npm run fetch-cards --workspace=server`);
      }
      expect(supportProblem(card), card.oracleText).toBeNull();
    });
  }
});