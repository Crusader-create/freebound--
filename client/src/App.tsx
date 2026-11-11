import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { BattlefieldCard, GameStateView, Target } from "../../shared/src/types";

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

function phaseLabel(phase: string): string {
  return phase.replace(/_/g, " ");
}

const isCreature = (c: BattlefieldCard) => c.card.types.includes("Creature");

function statsOf(c: BattlefieldCard): string {
  if (!isCreature(c)) return "";
  const power = (c.card.power ?? 0) + c.powerModifier;
  const toughness = (c.card.toughness ?? 0) + c.toughnessModifier;
  return ` ${power}/${toughness}`;
}

function Battlefield({ cards }: { cards: BattlefieldCard[] }) {
  return (
    <ul>
      {cards.map((c) => (
        <li key={c.instanceId}>
          {c.card.name}
          {statsOf(c)}
          {c.damageMarked > 0 ? ` (damage ${c.damageMarked})` : ""}
          {c.tapped ? " (tapped)" : ""}
          {c.summoningSick && isCreature(c) ? " (summoning sick)" : ""}
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [status, setStatus] = useState("connecting...");
  const [deckText, setDeckText] = useState("");
  const [errors, setErrors] = useState<DeckError[]>([]);
  const [game, setGame] = useState<GameStateView | null>(null);
  const [casting, setCasting] = useState<{ cardInstanceId: string; name: string } | null>(null);

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
    const onState = (data: { gameState: GameStateView }) => {
      setGame(data.gameState);
      setStatus("OK");
    };
    const onGameError = (data: { message: string }) => setStatus("Error: " + data.message);

    socket.on("connect", onConnect);
    socket.on("pong_test", onPong);
    socket.on("queued", onQueued);
    socket.on("deck_invalid", onInvalid);
    socket.on("match_found", onMatch);
    socket.on("state_update", onState);
    socket.on("game_error", onGameError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("pong_test", onPong);
      socket.off("queued", onQueued);
      socket.off("deck_invalid", onInvalid);
      socket.off("match_found", onMatch);
      socket.off("state_update", onState);
      socket.off("game_error", onGameError);
    };
  }, []);

  const myPriority = game !== null && game.priorityPlayerId === game.you.id;
  const myTurn = game !== null && game.activePlayerId === game.you.id;
  const inMainPhase = game !== null && (game.phase === "main1" || game.phase === "main2");
  const sorcerySpeedOk =
    game !== null &&
    game.status === "in_progress" &&
    myTurn &&
    myPriority &&
    inMainPhase &&
    game.stack.length === 0;
  const instantSpeedOk = game !== null && game.status === "in_progress" && myPriority;
  const canPlayLand = game !== null && sorcerySpeedOk && game.you.landsPlayedThisTurn < 1;

  function chooseTarget(target: Target) {
    if (!casting) return;
    socket.emit("cast_spell", { cardInstanceId: casting.cardInstanceId, targets: [target] });
    setCasting(null);
  }

  function describeTarget(target: Target): string {
    if (!game) return "";
    if (target.kind === "player") {
      return target.playerId === game.you.id ? "you" : "opponent";
    }
    if (target.kind === "permanent") {
      const all = [...game.you.battlefield, ...game.opponent.battlefield];
      return all.find((p) => p.instanceId === target.instanceId)?.card.name ?? "a creature that's gone";
    }
    return "a spell";
  }

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

          {game.status === "mulligan" && (
            <div style={{ margin: "16px 0", padding: 12, border: "1px solid #888" }}>
              {!game.you.keptHand ? (
                <>
                  <p>
                    Keep this hand, or mulligan? (Mulligans taken: {game.you.mulligansTaken})
                  </p>
                  <button onClick={() => socket.emit("mulligan_decision", { keep: true })}>
                    Keep
                  </button>{" "}
                  <button
                    disabled={game.you.mulligansTaken >= 6}
                    onClick={() => socket.emit("mulligan_decision", { keep: false })}
                  >
                    Mulligan
                  </button>
                  {game.you.mulligansTaken > 0 && (
                    <p>
                      If you keep, {game.you.mulligansTaken} random card(s) go to the bottom
                      of your library.
                    </p>
                  )}
                </>
              ) : (
                <p>Hand kept. Waiting for opponent...</p>
              )}
            </div>
          )}

          {game.status === "in_progress" && (
            <div style={{ margin: "16px 0", padding: 12, border: "1px solid #888" }}>
              <p>
                <strong>Turn {game.turnNumber}</strong> - {myTurn ? "your turn" : "opponent's turn"}{" "}
                - step: <strong>{phaseLabel(game.phase)}</strong>
              </p>
              <p>{myPriority ? "You have priority." : "Opponent has priority."}</p>
              <button disabled={!myPriority} onClick={() => socket.emit("pass_priority")}>
                Pass priority
              </button>
              {import.meta.env.DEV && (
                <button style={{ marginLeft: 8 }} onClick={() => socket.emit("debug_pass_both")}>
                  Pass for both players (dev only)
                </button>
              )}

              <h3>Stack ({game.stack.length})</h3>
              {game.stack.length === 0 ? (
                <p>(empty)</p>
              ) : (
                <ul>
                  {game.stack
                    .slice()
                    .reverse()
                    .map((item, i) => (
                      <li key={item.id}>
                        {item.source.card.name} - cast by{" "}
                        {item.controllerId === game.you.id ? "you" : "opponent"}
                        {item.targets.length > 0
                          ? `, targeting ${item.targets.map(describeTarget).join(", ")}`
                          : ""}
                        {i === 0 ? " (top, resolves next)" : ""}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {game.status === "finished" && (
            <p>
              <strong>Game over.</strong>{" "}
              {game.winnerId === null
                ? "Draw"
                : game.winnerId === game.you.id
                  ? "You win"
                  : "You lose"}{" "}
              ({game.endReason})
            </p>
          )}

          {casting && (
            <div style={{ margin: "16px 0", padding: 12, border: "1px solid #c80" }}>
              <p>
                <strong>Choose a target for {casting.name}:</strong>
              </p>
              <button onClick={() => chooseTarget({ kind: "player", playerId: game.you.id })}>
                You
              </button>{" "}
              <button onClick={() => chooseTarget({ kind: "player", playerId: game.opponent.id })}>
                Opponent
              </button>
              <ul>
                {[
                  ...game.you.battlefield.filter(isCreature).map((c) => ({ c, owner: "yours" })),
                  ...game.opponent.battlefield
                    .filter(isCreature)
                    .map((c) => ({ c, owner: "opponent's" })),
                ].map(({ c, owner }) => (
                  <li key={c.instanceId}>
                    <button
                      onClick={() => chooseTarget({ kind: "permanent", instanceId: c.instanceId })}
                    >
                      {c.card.name}
                      {statsOf(c)} ({owner})
                    </button>
                  </li>
                ))}
              </ul>
              <button onClick={() => setCasting(null)}>Cancel</button>
            </div>
          )}

          <p>
            Your life: {game.you.life} | Your library: {game.you.libraryCount} cards | Lands
            played this turn: {game.you.landsPlayedThisTurn}
          </p>

          <h3>Your hand ({game.you.handCount})</h3>
          <ul>
            {game.you.hand?.map((c) => {
              const types = c.card.types;
              return (
                <li key={c.instanceId}>
                  {c.card.name} {c.card.manaCost}{" "}
                  {types.includes("Land") && (
                    <button
                      disabled={!canPlayLand}
                      onClick={() => socket.emit("play_land", { cardInstanceId: c.instanceId })}
                    >
                      Play land
                    </button>
                  )}
                  {types.includes("Creature") && (
                    <button
                      disabled={!sorcerySpeedOk}
                      onClick={() => socket.emit("cast_spell", { cardInstanceId: c.instanceId })}
                    >
                      Cast
                    </button>
                  )}
                  {types.includes("Instant") && (
                    <button
                      disabled={!instantSpeedOk}
                      onClick={() => setCasting({ cardInstanceId: c.instanceId, name: c.card.name })}
                    >
                      Cast...
                    </button>
                  )}
                  {types.includes("Sorcery") && (
                    <button
                      disabled={!sorcerySpeedOk}
                      onClick={() => setCasting({ cardInstanceId: c.instanceId, name: c.card.name })}
                    >
                      Cast...
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <h3>Your battlefield ({game.you.battlefield.length})</h3>
          <Battlefield cards={game.you.battlefield} />
          <p>
            Your graveyard ({game.you.graveyard.length}):{" "}
            {game.you.graveyard.map((c) => c.card.name).join(", ") || "empty"}
          </p>

          <h3>Opponent</h3>
          <p>
            Life: {game.opponent.life} | Hand: {game.opponent.handCount} cards | Library:{" "}
            {game.opponent.libraryCount} cards
          </p>
          <h3>Opponent's battlefield ({game.opponent.battlefield.length})</h3>
          <Battlefield cards={game.opponent.battlefield} />
          <p>
            Opponent's graveyard ({game.opponent.graveyard.length}):{" "}
            {game.opponent.graveyard.map((c) => c.card.name).join(", ") || "empty"}
          </p>
        </div>
      )}
    </div>
  );
}