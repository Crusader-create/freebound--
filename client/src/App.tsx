import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { GameStateView } from "../../shared/src/types";

const socket = io("http://localhost:3001");

// Test convenience only: the Red Burn deck, so two tabs can queue quickly.
const SAMPLE_DECK = `4 Swab Goblin
4 Brazen Scourge
4 Elder Auntie
4 Skyraker Giant
3 Fire Elemental
3 Quaketusk Boar
2 Rearing Embermare
4 Shock
4 Lightning Strike
3 Sear
3 Bombard
22 Mountain`;

type DeckError = { code: string; message: string };

export default function App() {
  const [status, setStatus] = useState("connecting...");
  const [deckText, setDeckText] = useState("");
  const [errors, setErrors] = useState<DeckError[]>([]);
  const [game, setGame] = useState<GameStateView | null>(null);

  useEffect(() => {
    const onConnect = () => setStatus("connected: " + socket.id);
    const onPong = (data: { message: string }) => setStatus("got reply: " + data.message);
    const onQueued = () => {
      setErrors([]);
      setStatus("In queue, waiting for an opponent...");
    };
    const onInvalid = (data: { errors: DeckError[] }) => {
      setErrors(data.errors);
      setStatus("Deck rejected");
    };
    const onMatch = (data: { opponentName: string }) =>
      setStatus("Match found! Opponent: " + data.opponentName);
    const onState = (data: { gameState: GameStateView }) => setGame(data.gameState);

    socket.on("connect", onConnect);
    socket.on("pong_test", onPong);
    socket.on("queued", onQueued);
    socket.on("deck_invalid", onInvalid);
    socket.on("match_found", onMatch);
    socket.on("state_update", onState);
    return () => {
      socket.off("connect", onConnect);
      socket.off("pong_test", onPong);
      socket.off("queued", onQueued);
      socket.off("deck_invalid", onInvalid);
      socket.off("match_found", onMatch);
      socket.off("state_update", onState);
    };
  }, []);

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif", maxWidth: 800 }}>
      <h1>Freebound</h1>
      <p>Status: {status}</p>
      <button onClick={() => socket.emit("ping_test")}>Ping server</button>

      {!game && (
        <div style={{ marginTop: 24 }}>
          <h2>Your deck</h2>
          <textarea
            rows={14}
            style={{ width: "100%" }}
            placeholder="Paste a decklist here"
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={() => setDeckText(SAMPLE_DECK)}>Fill sample deck</button>
            <button onClick={() => socket.emit("join_queue", { deckText })}>Find match</button>
          </div>
          {errors.length > 0 && (
            <ul style={{ color: "crimson" }}>
              {errors.map((err, i) => (
                <li key={i}>{err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {game && (
        <div style={{ marginTop: 24 }}>
          <h2>
            {game.firstPlayerId === game.you.id ? "You go first" : "Opponent goes first"}
          </h2>
          <p>
            Your life: {game.you.life} | Your library: {game.you.libraryCount} cards
          </p>
          <h3>Your hand ({game.you.handCount})</h3>
          <ul>
            {game.you.hand?.map((c) => (
              <li key={c.instanceId}>
                {c.card.name} {c.card.manaCost}
              </li>
            ))}
          </ul>
          <h3>Opponent</h3>
          <p>
            Life: {game.opponent.life} | Hand: {game.opponent.handCount} cards | Library:{" "}
            {game.opponent.libraryCount} cards
          </p>
        </div>
      )}
    </div>
  );
}