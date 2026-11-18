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
  powerModifier: number; // "until end of turn" bonus/penalty, cleared at cleanup
  toughnessModifier: number; // same; effective toughness = card.toughness + this
  attacking: boolean;
  blockingInstanceId?: string; // which attacker this creature is blocking
  blockedBy?: string[]; // on an attacker: its blockers, in the order declared. Stays set even if they die
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
  stopAtOpponentEndStep: boolean; // the player's "End-step stops" setting (see autoPass.ts)
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
  /** For a triggered ability: a short description of what it does, for the UI. */
  description?: string;
};

/**
 * A triggered ability that has triggered but isn't on the stack yet. It
 * waits in GameState.pendingTriggers until state-based actions have been
 * checked, then goes on the stack. If it needs a target, the game waits
 * for its controller to choose one first (GameState.awaiting = "trigger_target").
 */
export type PendingTrigger = {
  controllerId: string;
  source: CardInstance;
  description: string;
  needsTarget: boolean;
};

// ---------- The game log ----------

/**
 * One line of the game log. `text` uses the placeholder "{p:<playerId>}"
 * wherever a player is named, so each client can render it as "You" or
 * "Opponent" from its own seat.
 */
export type LogEntry = {
  turn: number;
  text: string;
};

// ---------- Game state ----------

/**
 * Every step of a turn, in order. Combat is split into its own steps because
 * players get priority in each one. "untap" and "cleanup" never give anyone
 * priority, so the game is never actually resting on them.
 */
export type Phase =
  | "untap"
  | "upkeep"
  | "draw"
  | "main1"
  | "beginning_of_combat"
  | "declare_attackers"
  | "declare_blockers"
  | "first_strike_damage" // only happens if a creature in combat has first strike
  | "combat_damage"
  | "end_of_combat"
  | "main2"
  | "end"
  | "cleanup";

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
  /**
   * Set while the game is waiting for a player's decision. Nobody has
   * priority until it's made.
   *   "attackers":      the active player must declare attackers
   *   "blockers":       the defending player must declare blockers
   *   "trigger_target": priorityPlayerId must pick a target for
   *                     pendingTriggers[0]
   *   "discard":        priorityPlayerId must discard down to hand size
   */
  awaiting: "attackers" | "blockers" | "trigger_target" | "discard" | null;
  turnNumber: number;
  phase: Phase;
  stack: StackObject[]; // the TOP of the stack is the LAST element
  /** Triggered abilities waiting to go on the stack (see PendingTrigger). */
  pendingTriggers: PendingTrigger[];
  /**
   * True once a player has deliberately acted or declared in the current
   * step. Auto-pass won't pass for the active player while this is set:
   * after attacking, they get to see the attack and respond before the
   * game moves on. Cleared whenever a new step begins.
   */
  actedThisStep: boolean;
  /**
   * What has happened, in order, written by the engine as it happens. Each
   * entry names players by id; the client renders them as "you" / "opponent".
   * Kept in the state so a reconnecting player gets the whole history back.
   */
  log: LogEntry[];
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