import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { parseDecklist } from "../../shared/src/deckParser";
import type { GameState } from "../../shared/src/types";
import { loadCardCache } from "./cards/cardCache";
import { validateDeck } from "./cards/validateDeck";
import { createGame, toView } from "./game/createGame";
import { MatchmakingQueue, type QueueEntry } from "./matchmaking";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173" }, // vite's default dev port
});

// Loaded once at startup so deck validation never touches the network.
const cardCache = loadCardCache();
console.log(`Loaded ${cardCache.size} card names into the cache.`);

const queue = new MatchmakingQueue();
const games = new Map<string, GameState>();
const gameBySocket = new Map<string, string>(); // socketId -> gameId

/** Sends each player their own filtered view of the game. */
function sendState(game: GameState) {
  for (const player of game.players) {
    io.to(player.id).emit("state_update", { gameState: toView(game, player.id) });
  }
}

function startGame(a: QueueEntry, b: QueueEntry) {
  const game = createGame(
    { id: a.socketId, name: "Player 1", deck: a.deck },
    { id: b.socketId, name: "Player 2", deck: b.deck }
  );
  games.set(game.gameId, game);
  gameBySocket.set(a.socketId, game.gameId);
  gameBySocket.set(b.socketId, game.gameId);

  for (const entry of [a, b]) {
    io.sockets.sockets.get(entry.socketId)?.join(game.gameId);
  }

  const [p1, p2] = game.players;
  io.to(p1.id).emit("match_found", { gameId: game.gameId, opponentName: p2.name });
  io.to(p2.id).emit("match_found", { gameId: game.gameId, opponentName: p1.name });
  sendState(game);

  console.log(`Game ${game.gameId} started: ${p1.id} vs ${p2.id}`);
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("ping_test", () => {
    socket.emit("pong_test", { message: "Server says hello", time: Date.now() });
  });

  socket.on("join_queue", (payload: unknown) => {
    const deckText = (payload as { deckText?: unknown } | null)?.deckText;
    if (typeof deckText !== "string") {
      socket.emit("deck_invalid", {
        errors: [{ code: "BAD_REQUEST", message: "Send your decklist as text." }],
        warnings: [],
      });
      return;
    }

    if (gameBySocket.has(socket.id)) {
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

    const entry: QueueEntry = { socketId: socket.id, deck: result.cards };
    const opponent = queue.join(entry);
    if (!opponent) {
      socket.emit("queued");
      return;
    }
    startGame(opponent, entry);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    queue.leave(socket.id);
    // Mid-game disconnect handling (the 60-second reconnect window) comes later.
  });
});

httpServer.listen(3001, () => {
  console.log("Server listening on http://localhost:3001");
});