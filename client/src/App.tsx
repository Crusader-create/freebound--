import { useEffect, useState } from "react";
import type {
  BattlefieldCard,
  Card,
  CardInstance,
  GameStateView,
  Target,
} from "../../shared/src/types";
import { socket } from "./socket";

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

const CARD_W = 110;
const CARD_H = Math.round(CARD_W * 1.4);

function phaseLabel(phase: string): string {
  return phase.replace(/_/g, " ");
}

const isCreature = (c: { card: Card }) => c.card.types.includes("Creature");

function statsOf(c: BattlefieldCard): string {
  if (!isCreature(c)) return "";
  const power = (c.card.power ?? 0) + c.powerModifier;
  const toughness = (c.card.toughness ?? 0) + c.toughnessModifier;
  return `${power}/${toughness}`;
}

/** A card picture. Falls back to a plain text card when there's no image. */
function CardImage({ card, dim = false }: { card: Card; dim?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style: React.CSSProperties = {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 6,
    opacity: dim ? 0.55 : 1,
    display: "block",
  };
  if (!card.imageUrl || broken) {
    return (
      <div
        style={{
          ...style,
          background: "#444",
          color: "#fff",
          fontSize: 11,
          padding: 6,
          boxSizing: "border-box",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ fontWeight: "bold" }}>{card.name}</div>
        <div>{card.manaCost}</div>
        {card.power !== undefined && (
          <div style={{ marginTop: 6 }}>
            {card.power}/{card.toughness}
          </div>
        )}
      </div>
    );
  }
  return (
    <img src={card.imageUrl} alt={card.name} title={card.name} style={style} onError={() => setBroken(true)} />
  );
}

/** A permanent on the battlefield: the image plus its combat/status markers. */
function Permanent({ c }: { c: BattlefieldCard }) {
  const border = c.attacking
    ? "3px solid #e33"
    : c.blockingInstanceId !== undefined
      ? "3px solid #36c"
      : "3px solid transparent";
  const sick = c.summoningSick && isCreature(c);
  return (
    <div style={{ display: "inline-block", margin: 4, textAlign: "center", width: CARD_W + 6 }}>
      <div
        style={{
          border,
          borderRadius: 8,
          transform: c.tapped ? "rotate(90deg)" : "none",
          transition: "transform 0.2s",
          margin: c.tapped ? `${(CARD_H - CARD_W) / 2}px 0` : 0,
        }}
      >
        <CardImage card={c.card} dim={sick} />
      </div>
      <div style={{ fontSize: 12, marginTop: 2 }}>
        {isCreature(c) && <strong>{statsOf(c)}</strong>}
        {c.damageMarked > 0 && <span style={{ color: "#c00" }}> -{c.damageMarked}</span>}
        {sick && <div>summoning sick</div>}
        {c.tapped && <div>tapped</div>}
        {c.attacking && <div style={{ color: "#e33" }}>attacking</div>}
        {c.blockingInstanceId !== undefined && <div style={{ color: "#36c" }}>blocking</div>}
        {c.blockedBy !== undefined && <div>blocked</div>}
      </div>
    </div>
  );
}

function Battlefield({ cards }: { cards: BattlefieldCard[] }) {
  if (cards.length === 0) return <p style={{ color: "#888" }}>(empty)</p>;
  // Lands behind, creatures in front, like a real table.
  const lands = cards.filter((c) => c.card.types.includes("Land"));
  const others = cards.filter((c) => !c.card.types.includes("Land"));
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {others.map((c) => (
          <Permanent key={c.instanceId} c={c} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {lands.map((c) => (
          <Permanent key={c.instanceId} c={c} />
        ))}
      </div>
    </div>
  );
}

function Graveyard({ cards, label }: { cards: CardInstance[]; label: string }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary>
        {label} ({cards.length})
      </summary>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {cards.map((c) => (
          <div key={c.instanceId} style={{ margin: 4 }}>
            <CardImage card={c.card} />
          </div>
        ))}
      </div>
    </details>
  );
}

export default function App() {
  const [status, setStatus] = useState("connecting...");
  const [deckText, setDeckText] = useState("");
  const [errors, setErrors] = useState<DeckError[]>([]);
  const [game, setGame] = useState<GameStateView | null>(null);
  const [casting, setCasting] = useState<{ cardInstanceId: string; name: string } | null>(null);
  const [selectedAttackers, setSelectedAttackers] = useState<string[]>([]);
  const [blockChoices, setBlockChoices] = useState<Record<string, string>>({});
  const [discardChoices, setDiscardChoices] = useState<string[]>([]);

  useEffect(() => {
    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("Connection lost, reconnecting...");
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
    const onOppLeft = (data: { graceSeconds: number }) =>
      setStatus(`Opponent disconnected. They have ${data.graceSeconds}s to return.`);
    const onOppBack = () => setStatus("Opponent reconnected.");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("queued", onQueued);
    socket.on("deck_invalid", onInvalid);
    socket.on("match_found", onMatch);
    socket.on("state_update", onState);
    socket.on("game_error", onGameError);
    socket.on("opponent_disconnected", onOppLeft);
    socket.on("opponent_reconnected", onOppBack);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("queued", onQueued);
      socket.off("deck_invalid", onInvalid);
      socket.off("match_found", onMatch);
      socket.off("state_update", onState);
      socket.off("game_error", onGameError);
      socket.off("opponent_disconnected", onOppLeft);
      socket.off("opponent_reconnected", onOppBack);
    };
  }, []);

  const myPriority = game !== null && game.priorityPlayerId === game.you.id;
  const myTurn = game !== null && game.activePlayerId === game.you.id;
  const inMainPhase = game !== null && (game.phase === "main1" || game.phase === "main2");
  const free = game !== null && game.status === "in_progress" && game.awaiting === null;
  const sorcerySpeedOk = game !== null && free && myTurn && myPriority && inMainPhase && game.stack.length === 0;
  const instantSpeedOk = free && myPriority;
  const canPlayLand = game !== null && sorcerySpeedOk && game.you.landsPlayedThisTurn < 1;
  const declaringAttackers = game !== null && game.awaiting === "attackers" && myTurn;
  const declaringBlockers = game !== null && game.awaiting === "blockers" && myPriority;
  const choosingTriggerTarget = game !== null && game.awaiting === "trigger_target" && myPriority;
  const discarding = game !== null && game.awaiting === "discard" && myPriority;
  const discardNeeded = game !== null ? Math.max(0, game.you.handCount - 7) : 0;

  function chooseTarget(target: Target) {
    if (!casting) return;
    socket.emit("cast_spell", { cardInstanceId: casting.cardInstanceId, targets: [target] });
    setCasting(null);
  }

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function submitAttackers() {
    socket.emit("declare_attackers", { attackerIds: selectedAttackers });
    setSelectedAttackers([]);
  }

  function submitBlockers() {
    const blocks = Object.entries(blockChoices)
      .filter(([, attackerId]) => attackerId !== "")
      .map(([blockerId, attackerId]) => ({ blockerId, attackerId }));
    socket.emit("declare_blockers", { blocks });
    setBlockChoices({});
  }

  function submitDiscard() {
    socket.emit("discard", { cardInstanceIds: discardChoices });
    setDiscardChoices([]);
  }

  function leaveGame() {
    socket.emit("leave_game");
    setGame(null);
    setStatus("OK");
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

  /** Clickable pictures of every legal "any target": both players and all creatures. */
  function TargetButtons({ onPick }: { onPick: (t: Target) => void }) {
    if (!game) return null;
    return (
      <>
        <button onClick={() => onPick({ kind: "player", playerId: game.you.id })}>
          You ({game.you.life})
        </button>{" "}
        <button onClick={() => onPick({ kind: "player", playerId: game.opponent.id })}>
          Opponent ({game.opponent.life})
        </button>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 8 }}>
          {[
            ...game.you.battlefield.filter(isCreature).map((c) => ({ c, owner: "yours" })),
            ...game.opponent.battlefield.filter(isCreature).map((c) => ({ c, owner: "opponent's" })),
          ].map(({ c, owner }) => (
            <div
              key={c.instanceId}
              style={{ margin: 4, cursor: "pointer", textAlign: "center" }}
              onClick={() => onPick({ kind: "permanent", instanceId: c.instanceId })}
            >
              <CardImage card={c.card} />
              <div style={{ fontSize: 12 }}>
                {statsOf(c)} ({owner})
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 1100 }}>
      <h1>Freebound</h1>
      <p>Status: {status}</p>

      {!game && (
        <div style={{ marginTop: 24 }}>
          <h2>Your deck</h2>
          <textarea
            rows={14}
            style={{ width: "100%", maxWidth: 600 }}
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
        <div style={{ marginTop: 16 }}>
          {game.status === "mulligan" && (
            <div style={{ margin: "16px 0", padding: 12, border: "1px solid #888" }}>
              <p>{game.firstPlayerId === game.you.id ? "You go first." : "Opponent goes first."}</p>
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
              <p>
                {game.awaiting === "attackers" &&
                  (myTurn ? "Declare your attackers." : "Opponent is declaring attackers...")}
                {game.awaiting === "blockers" &&
                  (myPriority ? "Declare your blockers." : "Opponent is declaring blockers...")}
                {game.awaiting === "trigger_target" &&
                  (myPriority
                    ? "Choose a target for your triggered ability."
                    : "Opponent is choosing a target...")}
                {game.awaiting === "discard" &&
                  (myPriority ? "Discard down to 7 cards." : "Opponent is discarding...")}
                {game.awaiting === null &&
                  (myPriority ? "You have priority." : "Opponent has priority.")}
              </p>
              <button
                disabled={!myPriority || game.awaiting !== null}
                onClick={() => socket.emit("pass_priority")}
              >
                Pass priority
              </button>
              {import.meta.env.DEV && (
                <button style={{ marginLeft: 8 }} onClick={() => socket.emit("debug_pass_both")}>
                  Pass for both players (dev only)
                </button>
              )}
              <button
                style={{ marginLeft: 8, color: "crimson" }}
                onClick={() => {
                  if (window.confirm("Concede the game?")) socket.emit("concede");
                }}
              >
                Concede
              </button>

              <h3>Stack ({game.stack.length})</h3>
              {game.stack.length === 0 ? (
                <p style={{ color: "#888" }}>(empty)</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap" }}>
                  {game.stack
                    .slice()
                    .reverse()
                    .map((item, i) => (
                      <div key={item.id} style={{ margin: 4, textAlign: "center", width: CARD_W + 40 }}>
                        <CardImage card={item.source.card} />
                        <div style={{ fontSize: 12, marginTop: 2 }}>
                          {i === 0 && <strong>resolves next</strong>}
                          <div>
                            {item.kind === "triggered_ability" ? item.description : "spell"} (
                            {item.controllerId === game.you.id ? "yours" : "opponent's"})
                          </div>
                          {item.targets.length > 0 && (
                            <div>targeting {item.targets.map(describeTarget).join(", ")}</div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {declaringAttackers && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #e33" }}>
              <p>
                <strong>Choose your attackers</strong> (click to toggle, or declare none):
              </p>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {game.you.battlefield.filter((c) => isCreature(c) && !c.tapped).map((c) => {
                  const picked = selectedAttackers.includes(c.instanceId);
                  return (
                    <div
                      key={c.instanceId}
                      onClick={() => toggle(selectedAttackers, setSelectedAttackers, c.instanceId)}
                      style={{
                        margin: 4,
                        cursor: "pointer",
                        textAlign: "center",
                        border: picked ? "3px solid #e33" : "3px solid transparent",
                        borderRadius: 8,
                      }}
                    >
                      <CardImage card={c.card} dim={c.summoningSick} />
                      <div style={{ fontSize: 12 }}>
                        {statsOf(c)}
                        {c.summoningSick ? " (sick)" : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
              <button style={{ marginTop: 8 }} onClick={submitAttackers}>
                Declare {selectedAttackers.length} attacker(s)
              </button>
            </div>
          )}

          {declaringBlockers && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #36c" }}>
              <p>
                <strong>Choose your blockers</strong> (or none):
              </p>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {game.you.battlefield.filter((c) => isCreature(c) && !c.tapped).map((blocker) => (
                  <div key={blocker.instanceId} style={{ margin: 4, textAlign: "center" }}>
                    <CardImage card={blocker.card} />
                    <div style={{ fontSize: 12 }}>{statsOf(blocker)} blocks</div>
                    <select
                      value={blockChoices[blocker.instanceId] ?? ""}
                      onChange={(e) =>
                        setBlockChoices({ ...blockChoices, [blocker.instanceId]: e.target.value })
                      }
                    >
                      <option value="">(nothing)</option>
                      {game.opponent.battlefield
                        .filter((a) => a.attacking)
                        .map((a) => (
                          <option key={a.instanceId} value={a.instanceId}>
                            {a.card.name} {statsOf(a)}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
              <button style={{ marginTop: 8 }} onClick={submitBlockers}>
                Declare blockers
              </button>
            </div>
          )}

          {choosingTriggerTarget && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #c80" }}>
              <p>
                <strong>
                  Choose a target for {game.pendingTriggers[0]?.description ?? "the ability"}:
                </strong>
              </p>
              <TargetButtons onPick={(t) => socket.emit("choose_trigger_target", { target: t })} />
            </div>
          )}

          {discarding && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #c80" }}>
              <p>
                <strong>Discard {discardNeeded} card(s)</strong> ({discardChoices.length} chosen):
              </p>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {game.you.hand?.map((c) => {
                  const picked = discardChoices.includes(c.instanceId);
                  return (
                    <div
                      key={c.instanceId}
                      onClick={() => toggle(discardChoices, setDiscardChoices, c.instanceId)}
                      style={{
                        margin: 4,
                        cursor: "pointer",
                        border: picked ? "3px solid #c80" : "3px solid transparent",
                        borderRadius: 8,
                      }}
                    >
                      <CardImage card={c.card} />
                    </div>
                  );
                })}
              </div>
              <button
                style={{ marginTop: 8 }}
                disabled={discardChoices.length !== discardNeeded}
                onClick={submitDiscard}
              >
                Discard
              </button>
            </div>
          )}

          {game.status === "finished" && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #888" }}>
              <p style={{ fontSize: 20 }}>
                <strong>Game over.</strong>{" "}
                {game.winnerId === null
                  ? "Draw"
                  : game.winnerId === game.you.id
                    ? "You win"
                    : "You lose"}{" "}
                ({game.endReason})
              </p>
              <button onClick={leaveGame}>Back to deck list</button>
            </div>
          )}

          {casting && (
            <div style={{ margin: "16px 0", padding: 12, border: "2px solid #c80" }}>
              <p>
                <strong>Choose a target for {casting.name}:</strong>
              </p>
              <TargetButtons onPick={chooseTarget} />
              <button style={{ marginTop: 8 }} onClick={() => setCasting(null)}>
                Cancel
              </button>
            </div>
          )}

          {/* ---------- opponent's side ---------- */}
          <h3>
            Opponent - life {game.opponent.life} - hand {game.opponent.handCount} - library{" "}
            {game.opponent.libraryCount}
          </h3>
          <Battlefield cards={game.opponent.battlefield} />
          <Graveyard cards={game.opponent.graveyard} label="Opponent's graveyard" />

          <hr style={{ margin: "24px 0" }} />

          {/* ---------- your side ---------- */}
          <h3>
            You - life {game.you.life} - library {game.you.libraryCount} - lands played this turn{" "}
            {game.you.landsPlayedThisTurn}
          </h3>
          <Battlefield cards={game.you.battlefield} />
          <Graveyard cards={game.you.graveyard} label="Your graveyard" />

          <h3>Your hand ({game.you.handCount})</h3>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {game.you.hand?.map((c) => {
              const types = c.card.types;
              const isLand = types.includes("Land");
              const needsTarget = types.includes("Instant") || types.includes("Sorcery");
              const canCast = types.includes("Instant") ? instantSpeedOk : sorcerySpeedOk;
              return (
                <div key={c.instanceId} style={{ margin: 4, textAlign: "center", width: CARD_W + 6 }}>
                  <CardImage card={c.card} />
                  <div style={{ marginTop: 4 }}>
                    {isLand ? (
                      <button
                        disabled={!canPlayLand}
                        onClick={() => socket.emit("play_land", { cardInstanceId: c.instanceId })}
                      >
                        Play
                      </button>
                    ) : (
                      <button
                        disabled={!canCast}
                        onClick={() =>
                          needsTarget
                            ? setCasting({ cardInstanceId: c.instanceId, name: c.card.name })
                            : socket.emit("cast_spell", { cardInstanceId: c.instanceId })
                        }
                      >
                        Cast
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}