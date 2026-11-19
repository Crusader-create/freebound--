import { randomUUID } from "crypto";
import express from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";
import { parseDecklist } from "../../shared/src/deckParser";
import type { CardPoolInfo, GameState, Target } from "../../shared/src/types";
import { loadCardCache } from "./cards/cardCache";
import { curatedPoolCards } from "./cards/curatedPool";
import { validateDeck } from "./cards/validateDeck";
import { setEndStepStop } from "./game/autoPass";
import { createGame, toView } from "./game/createGame";
import { isBlockAssignment, type BlockAssignment } from "./game/combat";
import { isTarget } from "./game/effects";
import { autoAdvance, processCommand, type GameCommand } from "./game/engine";
import { SUPPORTED_KEYWORDS } from "./game/keywords";
import { log, p } from "./game/log";
import { keepHand, takeMulligan } from "./game/mulligan";
import { opponentOf } from "./game/stateHelpers";
import { MatchmakingQueue, type QueueEntry } from "./matchmaking";

// ---------- configuration (from the environment when hosted) ----------

const PORT = Number(process.env.PORT ?? 3001);
// Comma-separated list of origins allowed to connect. Locally that's Vite.
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());
const IS_PRODUCTION = process.env.NODE_ENV === "production";
/** How long a disconnected player has to come back before they forfeit. */
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 60_000);
/** Decklists bigger than this are rejected before parsing. */
const MAX_DECK_TEXT = 20_000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGINS } });

/** Hosts poll this to know the server is up. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, games: games.size, uptimeSeconds: Math.round(process.uptime()) });
});

// Loaded once at startup so deck validation never touches the network.
const cardCache = loadCardCache();
console.log(`Loaded ${cardCache.size} card names into the cache.`);

// The lobby's "Cards you can use" list. Built once; it never changes while running.
const CARD_POOL_INFO: CardPoolInfo = {
  keywords: [...SUPPORTED_KEYWORDS],
  cards: curatedPoolCards(cardCache),
};

// ---------- players, sessions, and games ----------

/**
 * A player's identity is a session token, NOT their socket id. The client
 * stores the token and presents it on every connection, so a refresh or a
 * dropped connection can be matched back to the same seat.
 */
type Session = {
  token: string;
  playerId: string; // the id used inside GameState
  socketId: string | null; // null while disconnected
  gameId: string | null;
  forfeitTimer: NodeJS.Timeout | null;
};

const sessions = new Map<string, Session>(); // token -> session
const sessionBySocket = new Map<string, Session>(); // socketId -> session
const sessionByPlayer = new Map<string, Session>(); // playerId -> session
const queue = new MatchmakingQueue();
const games = new Map<string, GameState>();

function newSession(): Session {
  const session: Session = {
    token: randomUUID(),
    playerId: randomUUID(),
    socketId: null,
    gameId: null,
    forfeitTimer: null,
  };
  sessions.set(session.token, session);
  sessionByPlayer.set(session.playerId, session);
  return session;
}

function attach(session: Session, socket: Socket) {
  if (session.socketId) sessionBySocket.delete(session.socketId);
  session.socketId = socket.id;
  sessionBySocket.set(socket.id, session);
  if (session.forfeitTimer) {
    clearTimeout(session.forfeitTimer);
    session.forfeitTimer = null;
  }
}

function socketFor(playerId: string): Socket | undefined {
  const session = sessionByPlayer.get(playerId);
  if (!session?.socketId) return undefined;
  return io.sockets.sockets.get(session.socketId);
}

/** Sends each player their own filtered view of the game. */
function sendState(game: GameState) {
  for (const player of game.players) {
    socketFor(player.id)?.emit("state_update", { gameState: toView(game, player.id) });
  }
}

function sendError(socket: Socket, message: string) {
  socket.emit("game_error", { message });
}

function endGame(game: GameState) {
  games.delete(game.gameId);
  for (const player of game.players) {
    const session = sessionByPlayer.get(player.id);
    if (session) session.gameId = null;
  }
}

/**
 * Runs a command against the game the socket's player is in. Commands are
 * handled one at a time (this code is synchronous), so two players acting
 * at the same moment can never interleave.
 */
function applyCommand(socket: Socket, command: GameCommand) {
  const session = sessionBySocket.get(socket.id);
  const game = session?.gameId ? games.get(session.gameId) : undefined;
  if (!session || !game) {
    sendError(socket, "You're not in a game.");
    return;
  }

  const result = processCommand(game, command);
  if (!result.ok) {
    sendError(socket, result.reason);
    return;
  }

  games.set(game.gameId, result.state);
  sendState(result.state);
  if (result.state.status === "finished") endGame(result.state);
}

function startGame(a: QueueEntry, b: QueueEntry) {
  const game = createGame(
    { id: a.playerId, name: "Player 1", deck: a.deck },
    { id: b.playerId, name: "Player 2", deck: b.deck }
  );
  games.set(game.gameId, game);
  for (const entry of [a, b]) {
    const session = sessionByPlayer.get(entry.playerId);
    if (session) session.gameId = game.gameId;
  }

  const [p1, p2] = game.players;
  socketFor(p1.id)?.emit("match_found", { gameId: game.gameId, opponentName: p2.name });
  socketFor(p2.id)?.emit("match_found", { gameId: game.gameId, opponentName: p1.name });
  sendState(game);

  console.log(`Game ${game.gameId} started: ${p1.id} vs ${p2.id}`);
}

/** The disconnected player didn't come back in time: their opponent wins. */
function forfeit(session: Session) {
  const game = session.gameId ? games.get(session.gameId) : undefined;
  if (!game || game.status === "finished") return;

  const winner = opponentOf(game, session.playerId).id;
  const ended: GameState = log(
    {
      ...game,
      status: "finished",
      winnerId: winner,
      endReason: "disconnect",
      awaiting: null,
    },
    `${p(session.playerId)} left the game. ${p(winner)} won the game.`
  );
  games.set(game.gameId, ended);
  sendState(ended);
  endGame(ended);
  console.log(`Game ${game.gameId}: ${session.playerId} forfeited by disconnect`);
}

// ---------- socket handling ----------

io.on("connection", (socket) => {
  // The client sends its saved token (if any) when it connects. A known
  // token gets its old session back; anything else gets a fresh one.
  //
  // One guard: if that token is ALREADY attached to a live socket, this is
  // a second tab (or window) presenting the same token, not a reconnect.
  // Seating it on the same session would make two tabs one player, so it
  // gets a fresh session of its own instead.
  const presented = socket.handshake.auth?.token;
  const existing = typeof presented === "string" ? sessions.get(presented) : undefined;
  const alreadyLive =
    existing?.socketId !== null &&
    existing?.socketId !== undefined &&
    io.sockets.sockets.has(existing.socketId);
  const session = existing && !alreadyLive ? existing : newSession();
  attach(session, socket);
  socket.emit("session", { token: session.token });

  const game = session.gameId ? games.get(session.gameId) : undefined;
  if (game) {
    // Reconnected mid-game: put them straight back at the table.
    socket.emit("state_update", { gameState: toView(game, session.playerId) });
    socketFor(opponentOf(game, session.playerId).id)?.emit("opponent_reconnected");
    console.log(`Player ${session.playerId} reconnected to game ${game.gameId}`);
  } else {
    console.log(`Client connected: ${socket.id} (player ${session.playerId})`);
  }

  // Lobby reference: every card decks may use, plus the supported keywords.
  socket.on("get_card_pool", (reply: unknown) => {
    if (typeof reply === "function") reply(CARD_POOL_INFO);
  });

  socket.on("ping_test", () => {
    socket.emit("pong_test", { message: "Server says hello", time: Date.now() });
  });

  socket.on("join_queue", (payload: unknown) => {
    const deckText = (payload as { deckText?: unknown } | null)?.deckText;
    if (typeof deckText !== "string" || deckText.length > MAX_DECK_TEXT) {
      socket.emit("deck_invalid", {
        errors: [{ code: "BAD_REQUEST", message: "Send your decklist as text." }],
        warnings: [],
      });
      return;
    }

    if (session.gameId) {
      socket.emit("deck_invalid", {
        errors: [{ code: "BAD_REQUEST", message: "You're already in a game." }],
        warnings: [],
      });
      return;
    }

    const result = validateDeck(parseDecklist(deckText), cardCache);
    if (!result.ok) {
      socket.emit("deck_invalid", { errors: result.errors, warnings: result.warnings });
      return;
    }

    const entry: QueueEntry = { playerId: session.playerId, deck: result.cards };
    const opponent = queue.join(entry);
    if (!opponent) {
      socket.emit("queued");
      return;
    }
    startGame(opponent, entry);
  });

  // The client only says keep/mulligan. The server works out which game the
  // player is in from their session, so a client can't act in someone else's.
  socket.on("mulligan_decision", (payload: unknown) => {
    const keep = (payload as { keep?: unknown } | null)?.keep;
    if (typeof keep !== "boolean") {
      sendError(socket, "Invalid mulligan decision.");
      return;
    }

    const game = session.gameId ? games.get(session.gameId) : undefined;
    if (!game) {
      sendError(socket, "You're not in a game.");
      return;
    }

    const result = keep
      ? keepHand(game, session.playerId)
      : takeMulligan(game, session.playerId);
    if (!result.ok) {
      sendError(socket, result.reason);
      return;
    }

    // If this keep started turn 1, let the game flow to the first real choice.
    const next = result.state.status === "in_progress" ? autoAdvance(result.state) : result.state;
    games.set(game.gameId, next);
    sendState(next);

    if (game.status === "mulligan" && next.status === "in_progress") {
      for (const player of result.state.players) {
        socketFor(player.id)?.emit("game_start", { gameId: game.gameId });
      }
    }
  });

  socket.on("pass_priority", () => {
    applyCommand(socket, { type: "PASS_PRIORITY", playerId: session.playerId });
  });

  socket.on("play_land", (payload: unknown) => {
    const cardInstanceId = (payload as { cardInstanceId?: unknown } | null)?.cardInstanceId;
    if (typeof cardInstanceId !== "string") {
      sendError(socket, "Invalid card.");
      return;
    }
    applyCommand(socket, { type: "PLAY_LAND", playerId: session.playerId, cardInstanceId });
  });

  socket.on("cast_spell", (payload: unknown) => {
    const cardInstanceId = (payload as { cardInstanceId?: unknown } | null)?.cardInstanceId;
    if (typeof cardInstanceId !== "string") {
      sendError(socket, "Invalid card.");
      return;
    }
    const rawTargets = (payload as { targets?: unknown } | null)?.targets ?? [];
    if (!Array.isArray(rawTargets) || !rawTargets.every(isTarget)) {
      sendError(socket, "Invalid targets.");
      return;
    }
    applyCommand(socket, {
      type: "CAST_SPELL",
      playerId: session.playerId,
      cardInstanceId,
      targets: rawTargets as Target[],
    });
  });

  socket.on("declare_attackers", (payload: unknown) => {
    const attackerIds = (payload as { attackerIds?: unknown } | null)?.attackerIds;
    if (!Array.isArray(attackerIds) || !attackerIds.every((id) => typeof id === "string")) {
      sendError(socket, "Invalid attackers.");
      return;
    }
    applyCommand(socket, {
      type: "DECLARE_ATTACKERS",
      playerId: session.playerId,
      attackerIds: attackerIds as string[],
    });
  });

  socket.on("declare_blockers", (payload: unknown) => {
    const blocks = (payload as { blocks?: unknown } | null)?.blocks;
    if (!Array.isArray(blocks) || !blocks.every(isBlockAssignment)) {
      sendError(socket, "Invalid blockers.");
      return;
    }
    applyCommand(socket, {
      type: "DECLARE_BLOCKERS",
      playerId: session.playerId,
      blocks: blocks as BlockAssignment[],
    });
  });

  socket.on("choose_trigger_target", (payload: unknown) => {
    const target = (payload as { target?: unknown } | null)?.target;
    if (!isTarget(target)) {
      sendError(socket, "Invalid target.");
      return;
    }
    applyCommand(socket, { type: "CHOOSE_TRIGGER_TARGET", playerId: session.playerId, target });
  });

  socket.on("discard", (payload: unknown) => {
    const ids = (payload as { cardInstanceIds?: unknown } | null)?.cardInstanceIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      sendError(socket, "Invalid discard.");
      return;
    }
    applyCommand(socket, {
      type: "DISCARD",
      playerId: session.playerId,
      cardInstanceIds: ids as string[],
    });
  });

  // A player setting, not a game action: it doesn't use priority or move the game.
  socket.on("set_end_step_stop", (payload: unknown) => {
    const on = (payload as { on?: unknown } | null)?.on;
    if (typeof on !== "boolean") return;
    const game = session.gameId ? games.get(session.gameId) : undefined;
    if (!game || game.status === "finished") return;
    const next = setEndStepStop(game, session.playerId, on);
    if (next === game) return;
    games.set(game.gameId, next);
    sendState(next);
  });

  socket.on("concede", () => {
    applyCommand(socket, { type: "CONCEDE", playerId: session.playerId });
  });

  // Leaves a finished game behind so the player can queue again.
  socket.on("leave_game", () => {
    const game = session.gameId ? games.get(session.gameId) : undefined;
    if (!game || game.status === "finished") session.gameId = null;
  });

  // Dev-only testing shortcut: both players pass, so one click advances a step.
  socket.on("debug_pass_both", () => {
    if (IS_PRODUCTION) return;

    const game = session.gameId ? games.get(session.gameId) : undefined;
    if (!game || game.status !== "in_progress") return;

    let state = game;
    for (let i = 0; i < 2; i++) {
      const result = processCommand(state, {
        type: "PASS_PRIORITY",
        playerId: state.priorityPlayerId,
      });
      if (!result.ok) break;
      state = result.state;
      if (state.consecutivePasses === 0) break; // the step advanced or the stack resolved
    }

    games.set(game.gameId, state);
    sendState(state);
  });

  socket.on("disconnect", () => {
    // Only react if this socket is still the session's current one. A
    // reconnect swaps in a new socket before the old one's disconnect fires.
    if (session.socketId !== socket.id) return;
    sessionBySocket.delete(socket.id);
    session.socketId = null;
    queue.leave(session.playerId);

    const game = session.gameId ? games.get(session.gameId) : undefined;
    if (game && game.status !== "finished") {
      console.log(`Player ${session.playerId} disconnected; ${RECONNECT_GRACE_MS / 1000}s to return`);
      socketFor(opponentOf(game, session.playerId).id)?.emit("opponent_disconnected", {
        graceSeconds: RECONNECT_GRACE_MS / 1000,
      });
      session.forfeitTimer = setTimeout(() => forfeit(session), RECONNECT_GRACE_MS);
    } else {
      console.log(`Client disconnected: ${socket.id}`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT} (${IS_PRODUCTION ? "production" : "development"})`);
  console.log(`Allowed client origins: ${ALLOWED_ORIGINS.join(", ")}`);
});