/**
 * socket.ts
 *
 * The one Socket.IO connection the client uses, plus the session token that
 * keeps a player in their seat across refreshes and dropped connections.
 *
 * The server hands out a token on every connection ("session" event). We
 * store it in localStorage and present it when (re)connecting, so the server
 * can match this browser back to its existing game.
 */

import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const TOKEN_KEY = "freebound.sessionToken";

function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode or storage disabled: we'll just get a fresh session
  }
}

export const socket = io(SERVER_URL, {
  // Sent with the handshake. Socket.IO re-reads `auth` on every reconnect
  // attempt, so updating it below keeps later reconnects using the newest token.
  auth: { token: savedToken() },
});

socket.on("session", ({ token }: { token: string }) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore: storage unavailable
  }
  socket.auth = { token };
});