/**
 * zoom.tsx
 *
 * Card magnifier. Hovering a card shows one large, upright copy of it
 * beside the card. The copy is drawn once, on top of the whole page
 * (position: fixed), so it's never clipped by the battlefield and never
 * rotated when the card is tapped.
 *
 *   <ZoomProvider>      wraps the app and draws the magnified card
 *   useZoom(card)       returns mouse handlers to put on a card's element
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Card } from "../../shared/src/types";

const ZOOM_W = 250; // a real card's 63:88 shape
const ZOOM_H = 349;
const GAP = 12; // space between the hovered card and the magnified one
const EDGE = 8; // never closer than this to the window edge

type Shown = { card: Card; rect: DOMRect; owner: symbol };

type ZoomApi = {
  show: (card: Card, rect: DOMRect, owner: symbol) => void;
  hide: (owner: symbol) => void;
};

const ZoomContext = createContext<ZoomApi>({ show: () => {}, hide: () => {} });

export function ZoomProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);

  const show = useCallback((card: Card, rect: DOMRect, owner: symbol) => {
    setShown({ card, rect, owner });
  }, []);
  // Only the card that opened the zoom may close it, so moving quickly from
  // one card to the next never hides the new one.
  const hide = useCallback((owner: symbol) => {
    setShown((current) => (current?.owner === owner ? null : current));
  }, []);

  return (
    <ZoomContext.Provider value={{ show, hide }}>
      {children}
      {shown && <Magnified card={shown.card} anchor={shown.rect} />}
    </ZoomContext.Provider>
  );
}

/** Mouse handlers that magnify `card` while the pointer is over the element. */
export function useZoom(card: Card) {
  const { show, hide } = useContext(ZoomContext);
  const owner = useRef(Symbol("zoom")).current;

  // If the card leaves the table while hovered (it died, resolved, was
  // discarded), its mouseleave never fires: close the zoom on unmount.
  useEffect(() => () => hide(owner), [hide, owner]);

  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
      show(card, e.currentTarget.getBoundingClientRect(), owner),
    onMouseLeave: () => hide(owner),
  };
}

/**
 * Where the magnified card goes: to the right of the hovered card if it
 * fits, else to the left, else above; then nudged to stay fully on screen.
 */
function placement(anchor: DOMRect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left: number;
  let top: number;
  if (anchor.right + GAP + ZOOM_W <= vw - EDGE) {
    left = anchor.right + GAP;
    top = anchor.top + anchor.height / 2 - ZOOM_H / 2;
  } else if (anchor.left - GAP - ZOOM_W >= EDGE) {
    left = anchor.left - GAP - ZOOM_W;
    top = anchor.top + anchor.height / 2 - ZOOM_H / 2;
  } else {
    left = anchor.left + anchor.width / 2 - ZOOM_W / 2;
    top = anchor.top - GAP - ZOOM_H;
  }

  left = Math.min(Math.max(left, EDGE), vw - ZOOM_W - EDGE);
  top = Math.min(Math.max(top, EDGE), vh - ZOOM_H - EDGE);
  return { left, top };
}

function Magnified({ card, anchor }: { card: Card; anchor: DOMRect }) {
  const [broken, setBroken] = useState(false);
  const [pos, setPos] = useState(() => placement(anchor));

  // Re-place when a different card is hovered or the window changes size.
  useLayoutEffect(() => {
    setBroken(false);
    setPos(placement(anchor));
    const onResize = () => setPos(placement(anchor));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [anchor]);

  const style = { left: pos.left, top: pos.top, width: ZOOM_W, height: ZOOM_H };

  if (!card.imageUrl || broken) {
    // No picture: a large text version with the full rules text.
    return (
      <div className="magnified magnified-text" style={style} aria-hidden>
        <div className="mt-head">
          <b>{card.name}</b>
          <span>{card.manaCost}</span>
        </div>
        <div className="mt-type">{card.types.join(" ")}</div>
        <div className="mt-rules">{card.oracleText}</div>
        {card.power !== undefined && (
          <div className="mt-pt">
            {card.power}/{card.toughness}
          </div>
        )}
      </div>
    );
  }

  return (
    <img
      className="magnified"
      style={style}
      src={card.imageUrl}
      alt=""
      aria-hidden
      onError={() => setBroken(true)}
    />
  );
}