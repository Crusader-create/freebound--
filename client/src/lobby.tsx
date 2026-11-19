/**
 * lobby.tsx
 *
 * Lobby-only pieces:
 *   - DeckBrowser: the sample decks as tiles, with a color filter and a
 *     random pick
 *   - CardPoolDialog: every card decks may use, plus the keywords that
 *     work, so nobody has to guess what will import
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CardPoolInfo } from "../../shared/src/types";
import { SAMPLE_DECKS, type DeckColor, type SampleDeck } from "../../shared/src/sampleDecks";
import { socket } from "./socket";

const COLOR_NAMES: Record<DeckColor, string> = {
  W: "White",
  R: "Red",
  G: "Green",
  B: "Black",
};
const COLOR_ORDER: DeckColor[] = ["W", "R", "G", "B"];

/**
 * Small color dots, e.g. for "Boros Blitz" a white and a red one. Pass
 * `decorative` when a text label already names the color, so screen
 * readers don't hear it twice.
 */
export function Pips({ colors, decorative = false }: { colors: DeckColor[]; decorative?: boolean }) {
  const label = colors.map((c) => COLOR_NAMES[c]).join(" and ");
  return (
    <span
      className="pips"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {colors.map((c) => (
        <span key={c} className={`pip pip-${c}`} />
      ))}
    </span>
  );
}

// ---------- deck browser ----------

type Filter = "all" | DeckColor;

export function DeckBrowser({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (deck: SampleDeck) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = SAMPLE_DECKS.filter((d) => filter === "all" || d.colors.includes(filter));

  function pickRandom() {
    // Prefer a deck other than the current one, so the button always changes something.
    const pool = shown.length > 1 ? shown.filter((d) => d.name !== selected) : shown;
    onPick(pool[Math.floor(Math.random() * pool.length)]);
  }

  return (
    <section className="deck-browser" aria-labelledby="deck-browser-title">
      <div className="section-head">
        <h2 id="deck-browser-title">Choose a deck</h2>
        <button className="quiet" onClick={pickRandom}>
          Random deck
        </button>
      </div>

      <div className="filters" role="group" aria-label="Show decks with this color">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          All
        </button>
        {COLOR_ORDER.map((c) => (
          <button key={c} aria-pressed={filter === c} onClick={() => setFilter(c)}>
            <Pips colors={[c]} decorative />
            {COLOR_NAMES[c]}
          </button>
        ))}
      </div>

      <ul className="deck-tiles">
        {shown.map((deck) => (
          <li key={deck.name}>
            <button
              className="deck-tile"
              aria-pressed={deck.name === selected}
              onClick={() => onPick(deck)}
            >
              <span className="deck-tile-head">
                <span className="deck-name">{deck.name}</span>
                <Pips colors={deck.colors} />
              </span>
              <span className="deck-desc">{deck.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- supported cards ----------

/** Which section a card is listed under. Lands have no colored mana symbol. */
function cardGroup(card: CardPoolInfo["cards"][number]): DeckColor | "land" {
  if (card.types.includes("Land")) return "land";
  const symbol = card.manaCost.match(/\{([WRGB])\}/);
  return symbol ? (symbol[1] as DeckColor) : "land";
}

/** "Creature — Cat Soldier" style type line, from ["Creature", "Cat", "Soldier"]. */
function typeLine(types: string[]): string {
  const main = types.filter((t) =>
    ["Basic", "Land", "Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Legendary"].includes(t)
  );
  const sub = types.filter((t) => !main.includes(t));
  return sub.length > 0 ? `${main.join(" ")} — ${sub.join(" ")}` : main.join(" ");
}

let poolCache: CardPoolInfo | null = null; // fetched once per visit

export function CardPoolDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pool, setPool] = useState<CardPoolInfo | null>(poolCache);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Open and close the native dialog (it handles focus and the Esc key).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Ask the server for the list the first time the dialog opens.
  useEffect(() => {
    if (!open || pool) return;
    setFailed(false);
    socket.timeout(15_000).emit("get_card_pool", (err: Error | null, info: CardPoolInfo) => {
      if (err) {
        setFailed(true);
        return;
      }
      poolCache = info;
      setPool(info);
    });
  }, [open, pool, failed]);

  const groups = useMemo(() => {
    if (!pool) return [];
    const q = query.trim().toLowerCase();
    const matches = pool.cards.filter((card) => {
      if (filter !== "all" && cardGroup(card) !== filter) return false;
      if (!q) return true;
      return (
        card.name.toLowerCase().includes(q) ||
        card.oracleText.toLowerCase().includes(q) ||
        card.types.join(" ").toLowerCase().includes(q)
      );
    });
    const order: (DeckColor | "land")[] = [...COLOR_ORDER, "land"];
    return order
      .map((group) => ({ group, cards: matches.filter((c) => cardGroup(c) === group) }))
      .filter((g) => g.cards.length > 0);
  }, [pool, query, filter]);

  const shownCount = groups.reduce((n, g) => n + g.cards.length, 0);

  return (
    <dialog
      ref={ref}
      className="pool-dialog"
      aria-labelledby="pool-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a click on the dimmed backdrop
      }}
    >
      <div className="pool-inner">
        <header className="pool-head">
          <div>
            <h2 id="pool-title">Cards you can use</h2>
            <p>
              Decks can only include these cards
              {pool ? ` (${pool.cards.length} in all)` : ""}. Any other card is rejected when you
              click Find a match, even if it's legal in Standard.
            </p>
          </div>
          <button className="quiet" onClick={onClose}>
            Close
          </button>
        </header>

        {!pool && !failed && <p className="pool-status">Loading the card list...</p>}
        {failed && (
          <p className="pool-status">
            The server didn't answer. It may be waking up, which takes about a minute.{" "}
            <button className="quiet" onClick={() => setFailed(false)}>
              Try again
            </button>
          </p>
        )}

        {pool && (
          <>
            <p className="pool-keywords">
              <strong>Keywords that work:</strong>{" "}
              {pool.keywords.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(", ")}.
              <br />
              <strong>Also supported:</strong> damage spells, +X/+X and −X/−X until end of turn,
              destroy target creature, Pacifism, mana creatures, and "when this enters" draw,
              gain life, deal damage, or make a token.
            </p>

            <div className="pool-controls">
              <input
                type="search"
                placeholder="Search names and rules text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search cards"
              />
              <div className="filters" role="group" aria-label="Show cards of this color">
                <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                  All
                </button>
                {COLOR_ORDER.map((c) => (
                  <button key={c} aria-pressed={filter === c} onClick={() => setFilter(c)}>
                    <Pips colors={[c]} decorative />
                    {COLOR_NAMES[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="pool-list">
              {shownCount === 0 && <p className="pool-status">No cards match "{query}".</p>}
              {groups.map(({ group, cards }) => (
                <section key={group}>
                  <h3>
                    {group === "land" ? "Lands" : COLOR_NAMES[group]}{" "}
                    <span className="count">{cards.length}</span>
                  </h3>
                  <ul>
                    {cards.map((card) => (
                      <li key={card.scryfallId} className="pool-card">
                        <div className="pool-card-head">
                          <span className="name">{card.name}</span>
                          <span className="cost">{card.manaCost}</span>
                        </div>
                        <div className="type">
                          <span>{typeLine(card.types)}</span>
                          {card.power !== undefined && (
                            <span className="pt">
                              {card.power}/{card.toughness}
                            </span>
                          )}
                        </div>
                        {card.oracleText && <div className="text">{card.oracleText}</div>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}