/**
 * types.ts — Freebound core data model (shared by client and server)
 *
 * Design notes:
 *  - `Card` is static card data (what Scryfall says a card IS).
 *  - `CardInstance` is one specific copy of a card in a game. A deck with
 *    4x Lightning Bolt has four CardInstances sharing one Card, each with
 *    its own instanceId, so events like cast_spell can name exactly which
 *    copy is meant.
 *  - The server holds the full `GameState`. Clients only ever receive a
 *    `GameStateView`, which hides the opponent's hand and both libraries.
 */

// ---------- Card data ----------

export type Color = "W" | "U" | "B" | "R" | "G";

/** Mana pool tracks colored mana plus colorless ("C"). */
export type ManaPool = Record<Color | "C", number>;

export type Card = {
  scryfallId: string;
  name: string;
  manaCost: string; // e.g. "{2}{R}"
  types: string[]; // ["Creature", "Human", "Wizard"]
  power?: number;
  toughness?: number;
  oracleText: string;
  imageUrl: string;
};

/** Shape written to server/data/card-cache.json by fetch-cards.ts. */
export type CachedCard = Card & { standardLegal: boolean };

// ---------- Card instances & zones ----------

export type Zone =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "stack"
  | "exile";

export type CardInstance = {
  instanceId: string; // unique per copy, per game
  card: Card;
  ownerId: string; // player who started with it in their deck
};

export type BattlefieldCard = CardInstance & {
  controllerId: string;
  tapped: boolean;
  summoningSick: boolean; // true until controller's next turn begins
  damageMarked: number; // cleared at end of turn
  attacking: boolean;
  blockingInstanceId?: string; // which attacker this creature is blocking
};

// ---------- Players ----------

export type Player = {
  id: string;
  name: string;
  life: number;
  library: CardInstance[];
  hand: CardInstance[];
  battlefield: BattlefieldCard[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  manaPool: ManaPool;
  mulligansTaken: number;
  keptHand: boolean; // true once the player has finished mulligan decisions
  landsPlayedThisTurn: number;
};

// ---------- The stack ----------

export type Target =
  | { kind: "player"; playerId: string }
  | { kind: "permanent"; instanceId: string }
  | { kind: "stack"; stackId: string };

export type StackObject = {
  id: string;
  controllerId: string;
  source: CardInstance;
  kind: "spell" | "triggered_ability";
  targets: Target[];
};

// ---------- Game state ----------

export type Phase =
  | "untap"
  | "upkeep"
  | "draw"
  | "main1"
  | "combat"
  | "main2"
  | "end";

export type GameStatus = "mulligan" | "in_progress" | "finished";

export type GameEndReason =
  | "life"
  | "decked"
  | "concede"
  | "disconnect";

export type GameState = {
  gameId: string;
  status: GameStatus;
  players: [Player, Player];
  firstPlayerId: string; // decided by coin flip; skips their first draw
  activePlayerId: string;
  priorityPlayerId: string;
  consecutivePasses: number; // phase/stack advances when this reaches 2
  turnNumber: number;
  phase: Phase;
  stack: StackObject[];
  winnerId: string | null;
  endReason: GameEndReason | null;
};

// ---------- What clients actually receive ----------

/**
 * A player as seen by a client. `hand` is only populated for the viewing
 * player; the opponent's hand and both libraries are reduced to counts.
 */
export type PlayerView = Omit<Player, "library" | "hand"> & {
  handCount: number;
  libraryCount: number;
  hand?: CardInstance[];
};

export type GameStateView = Omit<GameState, "players"> & {
  you: PlayerView;
  opponent: PlayerView;
};