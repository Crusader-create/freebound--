/**
 * socket.ts
 *
 * The one Socket.IO connection the client uses, plus the session token that
 * keeps a player in their seat across refreshes and dropped connections.
 *
 * The server hands out a token on every connection ("session" event). We
 * store it in sessionStorage and present it when (re)connecting, so the
 * server can match this tab back to its existing game.
 *
 * sessionStorage, not localStorage, on purpose: it's per-tab. With
 * localStorage every tab would share one token and the server would treat
 * them as one player. A refresh keeps sessionStorage, which is the case
 * that matters.
 */

import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const TOKEN_KEY = "freebound.sessionToken";

function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // storage disabled: we'll just get a fresh session
  }
}

export const socket = io(SERVER_URL, {
  // Sent with the handshake. Socket.IO re-reads `auth` on every reconnect
  // attempt, so updating it below keeps later reconnects using the newest token.
  auth: { token: savedToken() },
});

socket.on("session", ({ token }: { token: string }) => {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore: storage unavailable
  }
  socket.auth = { token };
});