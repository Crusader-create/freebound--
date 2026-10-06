/**
 * fetch-cards.ts
 *
 * One-off / startup script: downloads Scryfall's "Oracle Cards" bulk data
 * (one entry per unique card, includes legalities) and writes a trimmed-down
 * local cache to disk, so the server never has to hit Scryfall's API live
 * during gameplay or deck import.
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { gunzipSync } from "zlib";

const SCRYFALL_HEADERS = {
  "User-Agent": "Freebound/0.1 (https://github.com/Crusader-create/freebound)",
  Accept: "application/json",
};

type ScryfallBulkDataEntry = {
  type: string;
  jsonl_download_uri: string;
  name: string;
  compressed_size: number;
};

type ScryfallCard = {
  id: string;
  name: string;
  mana_cost?: string;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  legalities: Record<string, string>;
  image_uris?: { normal?: string };
  // Double-faced cards keep their real data under card_faces instead of
  // top-level fields — we fall back to the front face for those.
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    image_uris?: { normal?: string };
  }>;
};

type CachedCard = {
  scryfallId: string;
  name: string;
  manaCost: string;
  types: string[];
  power?: number;
  toughness?: number;
  oracleText: string;
  imageUrl: string;
  standardLegal: boolean;
};

async function getOracleCardsDownloadUrl(): Promise<string> {
  const res = await fetch("https://api.scryfall.com/bulk-data", {
    headers: SCRYFALL_HEADERS,
  });
  if (!res.ok) {
    throw new Error(`Failed to list bulk data: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data: ScryfallBulkDataEntry[] };
  const oracleCards = body.data.find((entry) => entry.type === "oracle_cards");
  if (!oracleCards) {
    throw new Error('Could not find a "oracle_cards" bulk data entry — Scryfall may have renamed it.');
  }
  console.log(
    `Found oracle_cards bulk file: ${(oracleCards.compressed_size / 1_000_000).toFixed(1)} MB compressed`
  );
  return oracleCards.jsonl_download_uri;
}

function normalizeCard(raw: ScryfallCard): CachedCard | null {
  // Skip tokens, art cards, and other non-playable layouts by requiring
  // at least an oracle_text or card_faces presence.
  const face = raw.card_faces?.[0];
  const name = raw.name;
  const manaCost = raw.mana_cost ?? face?.mana_cost ?? "";
  const typeLine = raw.type_line ?? face?.type_line ?? "";
  const oracleText = raw.oracle_text ?? face?.oracle_text ?? "";
  const imageUrl = raw.image_uris?.normal ?? face?.image_uris?.normal ?? "";

  if (!typeLine) return null;

  const types = typeLine
    .split("—")[0]
    .trim()
    .split(" ")
    .filter(Boolean);

  const powerRaw = raw.power ?? face?.power;
  const toughnessRaw = raw.toughness ?? face?.toughness;

  return {
    scryfallId: raw.id,
    name,
    manaCost,
    types,
    power: powerRaw !== undefined && !isNaN(Number(powerRaw)) ? Number(powerRaw) : undefined,
    toughness: toughnessRaw !== undefined && !isNaN(Number(toughnessRaw)) ? Number(toughnessRaw) : undefined,
    oracleText,
    imageUrl,
    standardLegal: raw.legalities?.standard === "legal",
  };
}

async function main() {
  console.log("Looking up Scryfall's oracle_cards bulk data location...");
  const downloadUrl = await getOracleCardsDownloadUrl();

  console.log("Downloading bulk card data (this can take a minute)...");
  const res = await fetch(downloadUrl, { headers: SCRYFALL_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to download bulk data: ${res.status} ${res.statusText}`);
  }

  // The file is gzip-compressed JSONL (one JSON object per line), not a
  // single JSON array — decompress, then split and parse line by line.
  const compressedBuffer = Buffer.from(await res.arrayBuffer());
  const jsonlText = gunzipSync(compressedBuffer).toString("utf-8");
  const lines = jsonlText.split("\n").filter((line) => line.trim().length > 0);

  console.log(`Downloaded ${lines.length} card entries. Normalizing...`);

  const rawCards: ScryfallCard[] = [];
  for (const line of lines) {
    try {
      rawCards.push(JSON.parse(line) as ScryfallCard);
    } catch {
      // Skip any malformed line rather than aborting the whole run.
      continue;
    }
  }

  const cache = new Map<string, CachedCard>();
  for (const raw of rawCards) {
    const normalized = normalizeCard(raw);
    if (!normalized) continue;
    // Oracle Cards has one entry per unique card name already, but in the
    // rare case of a collision, keep the first one we see.
    const key = normalized.name.toLowerCase();
    if (!cache.has(key)) cache.set(key, normalized);
  }

  const outDir = join(process.cwd(), "data");
  const outPath = join(outDir, "card-cache.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(Array.from(cache.values())), "utf-8");

  console.log(`Wrote ${cache.size} cards to ${outPath}`);
}

main().catch((err) => {
  console.error("fetch-cards failed:", err);
  process.exit(1);
});

/**
 * npm run fetch-cards --workspace=server
 * Re-run it occasionally (new sets release, Standard rotates) — nothing
 * in the app does this automatically, it's a manual refresh step.
 */