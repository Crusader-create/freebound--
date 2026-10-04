export type Card = {
  scryfallId: string;
  name: string;
  manaCost: string;
  types: string[];
  power?: number;
  toughness?: number;
  oracleText: string;
  imageUrl: string;
};

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "stack" | "exile";

export type BattlefieldCard = {
  instanceId: string;
  card: Card;
  tapped: boolean;
  damageMarked: number;
};

export type Player = {
  id: string;
  life: number;
  library: Card[];
  hand: Card[];
  battlefield: BattlefieldCard[];
  graveyard: Card[];
  mulligansTaken: number;
  landsPlayedThisTurn: number;
};

export type GameState = {
  gameId: string;
  players: [Player, Player];
  activePlayer: string;
  phase: "untap" | "upkeep" | "draw" | "main1" | "combat" | "main2" | "end";
  priorityPlayer: string;
  stack: unknown[]; 
};