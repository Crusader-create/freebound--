import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BattlefieldCard,
  Card,
  GameStateView,
  Target,
} from "../../shared/src/types";
import { SAMPLE_DECKS } from "./sampleDecks";
import { socket } from "./socket";
import { loadMusicPref, saveMusicPref, startMusic, stopMusic } from "./music";

type DeckError = { code: string; message: string };

const STEP_NAMES: Record<string, string> = {
  untap: "Untap",
  upkeep: "Upkeep",
  draw: "Draw",
  main1: "Main phase",
  beginning_of_combat: "Beginning of combat",
  declare_attackers: "Declare attackers",
  declare_blockers: "Declare blockers",
  first_strike_damage: "First strike damage",
  combat_damage: "Combat damage",
  end_of_combat: "End of combat",
  main2: "Second main phase",
  end: "End step",
  cleanup: "Cleanup",
};

const isCreature = (c: { card: Card }) => c.card.types.includes("Creature");
const isLand = (c: { card: Card }) => c.card.types.includes("Land");

function power(c: BattlefieldCard) {
  return (c.card.power ?? 0) + c.powerModifier;
}
function toughness(c: BattlefieldCard) {
  return (c.card.toughness ?? 0) + c.toughnessModifier;
}

// ---------- cards ----------

/** A card picture with a hover zoom. Falls back to text when there's no image. */
function CardImage({ card, big = false }: { card: Card; big?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!card.imageUrl || broken) {
    return (
      <div className="card-text">
        <b>{card.name}</b>
        <span>{card.manaCost}</span>
        {card.power !== undefined && (
          <span>
            {card.power}/{card.toughness}
          </span>
        )}
      </div>
    );
  }
  return (
    <span className="zoom">
      <img className="card" src={card.imageUrl} alt={card.name} onError={() => setBroken(true)} />
      {big && <img className="big" src={card.imageUrl} alt="" aria-hidden />}
    </span>
  );
}

function Permanent({
  c,
  pickable = false,
  picked = false,
  onPick,
}: {
  c: BattlefieldCard;
  pickable?: boolean;
  picked?: boolean;
  onPick?: () => void;
}) {
  const sick = c.summoningSick && isCreature(c);
  const classes = [
    "perm",
    c.tapped && "tapped",
    c.attacking && "attacking",
    c.blockingInstanceId !== undefined && "blocking",
    sick && "sick",
    pickable && "pickable",
    picked && "picked",
  ]
    .filter(Boolean)
    .join(" ");
  const hurt = c.damageMarked > 0 || c.toughnessModifier < 0;
  return (
    <div className={classes} onClick={pickable ? onPick : undefined} title={c.card.name}>
      <div className="frame">
        <CardImage card={c.card} big />
      </div>
      {c.attacking && <span className="tag">attacking</span>}
      {c.blockingInstanceId !== undefined && <span className="tag">blocking</span>}
      {!c.attacking && c.blockingInstanceId === undefined && sick && <span className="tag">new</span>}
      {isCreature(c) && (
        <span className={"pt" + (hurt ? " hurt" : "")}>
          {power(c)}/{toughness(c) - c.damageMarked}
        </span>
      )}
    </div>
  );
}

function Field({ cards, mine }: { cards: BattlefieldCard[]; mine: boolean }) {
  const lands = cards.filter(isLand);
  const others = cards.filter((c) => !isLand(c));
  // Creatures sit nearest the middle of the table on both sides.
  const rows = mine ? [others, lands] : [lands, others];
  return (
    <div className="field">
      {cards.length === 0 ? (
        <div className="row is-empty">
          <span className="empty">nothing on the battlefield yet</span>
        </div>
      ) : (
        rows.map((row, i) => (
          <div className="row" key={i}>
            {row.map((c) => (
              <Permanent key={c.instanceId} c={c} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ---------- game log ----------

// The server writes {p:id} for a player and {P:id} for "player's".
// Each seat sees itself as "You" and the other seat as "Opponent".
function renderLogText(text: string, myId: string): string {
  const out = text
    .replace(/\{p:([^}]+)\}/g, (_, id) => (id === myId ? "you" : "your opponent"))
    .replace(/\{P:([^}]+)\}/g, (_, id) => (id === myId ? "your" : "your opponent's"));
  // Capitalize the start of every sentence ("you" -> "You").
  return out.replace(/(^|[.:]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

const LOG_PREF_KEY = "freebound.showLog";
const END_STOP_PREF_KEY = "freebound.endStepStop";

function loadEndStopPref(): boolean {
  try {
    return localStorage.getItem(END_STOP_PREF_KEY) === "on"; // off unless turned on
  } catch {
    return false;
  }
}

function saveEndStopPref(on: boolean) {
  try {
    localStorage.setItem(END_STOP_PREF_KEY, on ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the setting still works for this game.
  }
}

function loadLogPref(): boolean {
  try {
    return localStorage.getItem(LOG_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveLogPref(on: boolean) {
  try {
    localStorage.setItem(LOG_PREF_KEY, on ? "on" : "off");
  } catch {
    // Storage can be unavailable (private mode); the toggle still works for this visit.
  }
}

function GameLog({ entries, myId }: { entries: { turn: number; text: string }[]; myId: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);
  return (
    <div className="log" aria-live="polite">
      <h3>Game log</h3>
      {entries.length === 0 ? (
        <p className="log-empty">Nothing has happened yet.</p>
      ) : (
        <ol>
          {entries.map((e, i) => {
            const newTurn = i === 0 || entries[i - 1].turn !== e.turn;
            return (
              <li key={i} className={newTurn && i > 0 ? "new-turn" : undefined}>
                {renderLogText(e.text, myId)}
              </li>
            );
          })}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}

// ---------- the app ----------

export default function App() {
  const [conn, setConn] = useState("Connecting...");
  const [deckName, setDeckName] = useState(() => {
    const names = Object.keys(SAMPLE_DECKS);
    return names[Math.floor(Math.random() * names.length)];
  });
  const [deckText, setDeckText] = useState(() => SAMPLE_DECKS[deckName].trim());
  const [errors, setErrors] = useState<DeckError[]>([]);
  const [queued, setQueued] = useState(false);
  const [game, setGame] = useState<GameStateView | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const [casting, setCasting] = useState<{ cardInstanceId: string; name: string } | null>(null);
  const [attackers, setAttackers] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Record<string, string>>({});
  const [discards, setDiscards] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(loadLogPref);
  const [musicOn, setMusicOn] = useState(loadMusicPref);
  const [endStop, setEndStop] = useState(loadEndStopPref);

  function toggleEndStop() {
    const on = !endStop;
    setEndStop(on);
    saveEndStopPref(on);
    socket.emit("set_end_step_stop", { on });
  }

  // The server keeps this setting per game, so send it whenever a game
  // (new or reconnected) doesn't match what this browser remembers.
  const serverEndStop = game?.you.stopAtOpponentEndStep;
  useEffect(() => {
    if (serverEndStop !== undefined && serverEndStop !== endStop) {
      socket.emit("set_end_step_stop", { on: endStop });
    }
  }, [serverEndStop, endStop]);

  function toggleMusic() {
    const on = !musicOn;
    setMusicOn(on);
    saveMusicPref(on);
    if (on) startMusic();
    else stopMusic();
  }

  // Browsers only allow sound after the player interacts with the page,
  // so the music starts on the first click or key press.
  useEffect(() => {
    if (!musicOn) return;
    const begin = () => startMusic();
    window.addEventListener("pointerdown", begin, { once: true });
    window.addEventListener("keydown", begin, { once: true });
    return () => {
      window.removeEventListener("pointerdown", begin);
      window.removeEventListener("keydown", begin);
    };
  }, [musicOn]);

  const musicButton = (
    <button className="quiet" aria-pressed={musicOn} onClick={toggleMusic}>
      {musicOn ? "Mute music" : "Play music"}
    </button>
  );

  function toggleLog() {
    setShowLog((on) => {
      saveLogPref(!on);
      return !on;
    });
  }

  useEffect(() => {
    const onConnect = () => setConn("Connected");
    // The socket may have connected before this listener was attached.
    if (socket.connected) onConnect();
    const onDisconnect = () => setConn("Connection lost. Reconnecting...");
    const onQueued = () => {
      setErrors([]);
      setQueued(true);
    };
    const onInvalid = (d: { errors: DeckError[] }) => {
      setErrors(d.errors);
      setQueued(false);
    };
    const onState = (d: { gameState: GameStateView }) => {
      setGame(d.gameState);
      setQueued(false);
    };
    const onError = (d: { message: string }) => setNotice({ text: d.message, error: true });
    const onOppLeft = (d: { graceSeconds: number }) =>
      setNotice({ text: `Your opponent disconnected. They have ${d.graceSeconds} seconds to return.` });
    const onOppBack = () => setNotice({ text: "Your opponent is back." });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("queued", onQueued);
    socket.on("deck_invalid", onInvalid);
    socket.on("state_update", onState);
    socket.on("game_error", onError);
    socket.on("opponent_disconnected", onOppLeft);
    socket.on("opponent_reconnected", onOppBack);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("queued", onQueued);
      socket.off("deck_invalid", onInvalid);
      socket.off("state_update", onState);
      socket.off("game_error", onError);
      socket.off("opponent_disconnected", onOppLeft);
      socket.off("opponent_reconnected", onOppBack);
    };
  }, []);

  // A notice clears itself after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Clear any half-made choice whenever the game moves on.
  useEffect(() => {
    setCasting(null);
    setAttackers([]);
    setBlocks({});
    setDiscards([]);
  }, [game?.phase, game?.awaiting, game?.turnNumber]);

  const you = game?.you;
  const opp = game?.opponent;
  const myPriority = !!game && game.priorityPlayerId === game.you.id;
  const myTurn = !!game && game.activePlayerId === game.you.id;
  const inMain = !!game && (game.phase === "main1" || game.phase === "main2");
  const free = !!game && game.status === "in_progress" && game.awaiting === null;
  const sorcerySpeed = free && myTurn && myPriority && inMain && game.stack.length === 0;
  const instantSpeed = free && myPriority;
  const canPlayLand = sorcerySpeed && !!you && you.landsPlayedThisTurn < 1;

  const prompt = useMemo(() => {
    if (!game) return null;
    if (game.status === "finished") return "finished";
    if (game.status === "mulligan") return you?.keptHand ? "waiting-keep" : "mulligan";
    if (casting) return "target";
    if (game.awaiting === "attackers") return myTurn ? "attackers" : "opp-attackers";
    if (game.awaiting === "blockers") return myPriority ? "blockers" : "opp-blockers";
    if (game.awaiting === "trigger_target") return myPriority ? "trigger" : "opp-trigger";
    if (game.awaiting === "discard") return myPriority ? "discard" : "opp-discard";
    return myPriority ? "priority" : "waiting";
  }, [game, you, casting, myTurn, myPriority]);

  const needsYou = ["mulligan", "target", "attackers", "blockers", "trigger", "discard", "priority"].includes(
    prompt ?? ""
  );

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  // ---------- lobby ----------

  if (!game) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>Freebound</h1>
          <p className="tagline">Paste a decklist. Find an opponent. Play.</p>
          <div className="decks">
            {Object.keys(SAMPLE_DECKS).map((name) => (
              <button
                key={name}
                className={name === deckName ? "primary" : ""}
                onClick={() => {
                  setDeckName(name);
                  setDeckText(SAMPLE_DECKS[name].trim());
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <textarea
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            placeholder={"4 Lightning Strike\n22 Mountain\n..."}
            spellCheck={false}
          />
          <div className="row">
            <button
              className="primary"
              disabled={queued}
              onClick={() => socket.emit("join_queue", { deckText })}
            >
              {queued ? "Looking for an opponent..." : "Find a match"}
            </button>
            <span className="status">{conn}</span>
            <span className="music-slot">{musicButton}</span>
          </div>
          {errors.length > 0 && (
            <ul className="errors">
              {errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ---------- table ----------

  const theirs = opp!;
  const mine = you!;

  const playerTarget = (id: string): Target => ({ kind: "player", playerId: id });
  const permTarget = (id: string): Target => ({ kind: "permanent", instanceId: id });

  function TargetChoices({ onPick }: { onPick: (t: Target) => void }) {
    return (
      <>
        <div className="player-targets">
          <button onClick={() => onPick(playerTarget(theirs.id))}>Opponent ({theirs.life})</button>
          <button onClick={() => onPick(playerTarget(mine.id))}>You ({mine.life})</button>
        </div>
        <div className="choices">
          {[...theirs.battlefield, ...mine.battlefield].filter(isCreature).map((c) => (
            <div key={c.instanceId} className="choice" onClick={() => onPick(permTarget(c.instanceId))}>
              <CardImage card={c.card} />
              <div className="name">
                {power(c)}/{toughness(c)} {c.controllerId === mine.id ? "yours" : "theirs"}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  function Panel() {
    switch (prompt) {
      case "mulligan":
        return (
          <>
            <h2>Keep this hand?</h2>
            <p>{game!.firstPlayerId === mine.id ? "You go first." : "Your opponent goes first."}</p>
            {mine.mulligansTaken > 0 && (
              <p>
                If you keep, {mine.mulligansTaken} random card{mine.mulligansTaken > 1 ? "s" : ""} go to
                the bottom of your library.
              </p>
            )}
            <div className="choices">
              <button className="primary" onClick={() => socket.emit("mulligan_decision", { keep: true })}>
                Keep
              </button>
              <button
                disabled={mine.mulligansTaken >= 6}
                onClick={() => socket.emit("mulligan_decision", { keep: false })}
              >
                Mulligan
              </button>
            </div>
          </>
        );
      case "waiting-keep":
        return (
          <>
            <h2>Hand kept</h2>
            <p>Waiting for your opponent to decide.</p>
          </>
        );
      case "target":
        return (
          <>
            <h2>Choose a target for {casting!.name}</h2>
            <TargetChoices
              onPick={(t) => {
                socket.emit("cast_spell", { cardInstanceId: casting!.cardInstanceId, targets: [t] });
                setCasting(null);
              }}
            />
            <button className="quiet" onClick={() => setCasting(null)}>
              Cancel
            </button>
          </>
        );
      case "attackers": {
        const able = mine.battlefield.filter((c) => isCreature(c) && !c.tapped);
        return (
          <>
            <h2>Choose your attackers</h2>
            <p>Click creatures to pick them, then confirm. Confirm with none to skip combat.</p>
            <div className="choices">
              {able.map((c) => (
                <Permanent
                  key={c.instanceId}
                  c={c}
                  pickable
                  picked={attackers.includes(c.instanceId)}
                  onPick={() => toggle(attackers, setAttackers, c.instanceId)}
                />
              ))}
            </div>
            <button
              className="primary"
              onClick={() => socket.emit("declare_attackers", { attackerIds: attackers })}
            >
              {attackers.length === 0 ? "No attack" : `Attack with ${attackers.length}`}
            </button>
          </>
        );
      }
      case "blockers": {
        const able = mine.battlefield.filter((c) => isCreature(c) && !c.tapped);
        const incoming = theirs.battlefield.filter((c) => c.attacking);
        return (
          <>
            <h2>Choose your blockers</h2>
            <p>Each of your creatures can block one attacker. Several can block the same one.</p>
            {able.map((b) => (
              <div className="block-row" key={b.instanceId}>
                <CardImage card={b.card} />
                <select
                  value={blocks[b.instanceId] ?? ""}
                  onChange={(e) => setBlocks({ ...blocks, [b.instanceId]: e.target.value })}
                >
                  <option value="">doesn't block</option>
                  {incoming.map((a) => (
                    <option key={a.instanceId} value={a.instanceId}>
                      blocks {a.card.name} ({power(a)}/{toughness(a)})
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button
              className="primary"
              onClick={() =>
                socket.emit("declare_blockers", {
                  blocks: Object.entries(blocks)
                    .filter(([, a]) => a !== "")
                    .map(([blockerId, attackerId]) => ({ blockerId, attackerId })),
                })
              }
            >
              Confirm blocks
            </button>
          </>
        );
      }
      case "trigger":
        return (
          <>
            <h2>{game!.pendingTriggers[0]?.description ?? "Choose a target"}</h2>
            <TargetChoices onPick={(t) => socket.emit("choose_trigger_target", { target: t })} />
          </>
        );
      case "discard": {
        const need = Math.max(0, mine.handCount - 7);
        return (
          <>
            <h2>Discard down to seven</h2>
            <p>
              Click {need} card{need > 1 ? "s" : ""} in your hand to discard. {discards.length} of {need}{" "}
              chosen.
            </p>
            <button
              className="primary"
              disabled={discards.length !== need}
              onClick={() => socket.emit("discard", { cardInstanceIds: discards })}
            >
              Discard
            </button>
          </>
        );
      }
      case "priority":
        return (
          <>
            <h2>{inMain && myTurn ? "Your main phase" : "You can respond"}</h2>
            <p>
              {inMain && myTurn
                ? "Play a land, cast spells, or move on."
                : game!.stack.length > 0
                  ? "Cast an instant, or pass to let the stack resolve."
                  : "Cast an instant, or pass."}
            </p>
            <button className="primary" onClick={() => socket.emit("pass_priority")}>
              {inMain && myTurn ? (game!.phase === "main1" ? "To combat" : "End turn") : "Pass"}
            </button>
          </>
        );
      case "opp-attackers":
        return <h2>Opponent is choosing attackers</h2>;
      case "opp-blockers":
        return <h2>Opponent is choosing blockers</h2>;
      case "opp-trigger":
        return <h2>Opponent is choosing a target</h2>;
      case "opp-discard":
        return <h2>Opponent is discarding</h2>;
      case "finished": {
        const won = game!.winnerId === mine.id;
        const why: Record<string, string> = {
          life: won ? "Your opponent ran out of life." : "You ran out of life.",
          decked: won ? "Your opponent ran out of cards." : "You ran out of cards.",
          concede: won ? "Your opponent conceded." : "You conceded.",
          disconnect: won ? "Your opponent left the game." : "You left the game.",
        };
        return (
          <>
            <div className="result">{game!.winnerId === null ? "Draw" : won ? "You win" : "You lose"}</div>
            <p>{why[game!.endReason ?? ""] ?? ""}</p>
            <button
              className="primary"
              onClick={() => {
                socket.emit("leave_game");
                setGame(null);
              }}
            >
              Back to the lobby
            </button>
          </>
        );
      }
      default:
        return (
          <>
            <h2>Waiting on your opponent</h2>
            <p>They're deciding what to do.</p>
          </>
        );
    }
  }

  return (
    <div className="table">
      <div className="bar opp-bar">
        <span className="who">Opponent</span>
        <span className={"life" + (theirs.life <= 5 ? " low" : "")}>{theirs.life}</span>
        <span className="stat">
          hand <b>{theirs.handCount}</b>
        </span>
        <span className="stat">
          library <b>{theirs.libraryCount}</b>
        </span>
        <span className="stat">
          graveyard <b>{theirs.graveyard.length}</b>
        </span>
      </div>

      <div className="opp-field">
        <Field cards={theirs.battlefield} mine={false} />
      </div>

      <div className="middle">
        <div className="turn">
          <div className="step">{STEP_NAMES[game.phase] ?? game.phase}</div>
          <div className="whose">
            Turn {game.turnNumber}. {myTurn ? "Your turn." : "Opponent's turn."}
          </div>
        </div>
        <div className="stack">
          {game.stack.length === 0 ? (
            <span className="label">the stack is empty</span>
          ) : (
            game.stack
              .slice()
              .reverse()
              .map((item, i) => (
                <div key={item.id} className="choice" title={item.description ?? item.source.card.name}>
                  <CardImage card={item.source.card} big />
                  <div className="name">
                    {i === 0 ? "resolves next" : ""}
                    {item.kind === "triggered_ability" ? " (ability)" : ""}
                  </div>
                </div>
              ))
          )}
        </div>
        <div className="actions">
          {import.meta.env.DEV && (
            <button className="quiet" onClick={() => socket.emit("debug_pass_both")}>
              dev: pass both
            </button>
          )}
          {musicButton}
          <button
            className="quiet"
            aria-pressed={endStop}
            onClick={toggleEndStop}
            title="When on, the game stops at your opponent's end step if you're holding an instant you could cast."
          >
            End-step stops: {endStop ? "on" : "off"}
          </button>
          <button className="quiet" aria-pressed={showLog} onClick={toggleLog}>
            {showLog ? "Hide log" : "Show log"}
          </button>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm("Concede this game?")) socket.emit("concede");
            }}
          >
            Concede
          </button>
        </div>
      </div>

      <div className="my-field">
        <Field cards={mine.battlefield} mine />
        <div className="bar my-bar">
          <span className="who">You</span>
          <span className={"life" + (mine.life <= 5 ? " low" : "")}>{mine.life}</span>
          <span className="stat">
            library <b>{mine.libraryCount}</b>
          </span>
          <span className="stat">
            graveyard <b>{mine.graveyard.length}</b>
          </span>
          <span className="stat">
            land drop <b>{mine.landsPlayedThisTurn < 1 ? "available" : "used"}</b>
          </span>
        </div>
      </div>

      <div className="hand">
        <div className="count">
          Hand
          <br />
          <b>{mine.handCount}</b>
        </div>
        <div className="fan">
          {mine.hand?.map((c) => {
            const land = isLand(c);
            const targeted = c.card.types.includes("Instant") || c.card.types.includes("Sorcery");
            const castOk = c.card.types.includes("Instant") ? instantSpeed : sorcerySpeed;
            const playable = prompt === "discard" ? false : land ? canPlayLand : castOk;
            const picked = prompt === "discard" && discards.includes(c.instanceId);
            return (
              <div
                key={c.instanceId}
                className={"hand-card" + (playable ? " playable" : "") + (picked ? " picked" : "")}
                onClick={prompt === "discard" ? () => toggle(discards, setDiscards, c.instanceId) : undefined}
              >
                <CardImage card={c.card} big />
                {prompt !== "discard" && (
                  <button
                    disabled={!playable}
                    onClick={() =>
                      land
                        ? socket.emit("play_land", { cardInstanceId: c.instanceId })
                        : targeted
                          ? setCasting({ cardInstanceId: c.instanceId, name: c.card.name })
                          : socket.emit("cast_spell", { cardInstanceId: c.instanceId })
                    }
                  >
                    {land ? "Play" : "Cast"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <aside className={"panel" + (needsYou ? " needs-you" : "")}>
        <Panel />
        {showLog && <GameLog entries={game.log ?? []} myId={mine.id} />}
        <div className="footer">
          {notice && <div className={"notice" + (notice.error ? " error" : "")}>{notice.text}</div>}
          <span className="conn">{conn}</span>
        </div>
      </aside>
    </div>
  );
}