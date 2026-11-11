/**
 * turns.ts
 *
 * Turn structure and priority. Like the mulligan code, these are pure
 * functions: they take a GameState and return a NEW one.
 *
 * How a turn runs:
 *   - Most steps give the active player priority first. Each player passes
 *     in turn; when BOTH pass in a row, the game moves to the next step.
 *     (With a non-empty stack, both passing resolves the top object
 *     instead, and the step doesn't end.)
 *   - "untap", "upkeep", "draw", and "cleanup" give nobody priority. The game
 *     moves straight through them, doing their automatic actions (the draw
 *     happens as the step is entered), so each turn begins in main phase 1.
 *   - Combat: if no creature was declared as an attacker, the declare
 *     blockers and combat damage steps are skipped, as in real Magic.
 *
 * Not here yet (later weeks): emptying mana pools between steps, discarding
 * to hand size at cleanup, ending "until end of turn" effects.
 */

import type { GameState, Phase } from "../../../shared/src/types";
import { resolveTopOfStack } from "./stack";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";

export const STEP_ORDER: readonly Phase[] = [
  "untap",
  "upkeep",
  "draw",
  "main1",
  "beginning_of_combat",
  "declare_attackers",
  "declare_blockers",
  "combat_damage",
  "end_of_combat",
  "main2",
  "end",
  "cleanup",
];

export type TurnResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

// ---------- the automatic parts of each step ----------

/** Untap step: the active player's permanents untap, and their land drop resets. */
function untapStep(state: GameState): GameState {
  const active = getPlayer(state, state.activePlayerId);
  return replacePlayer(
    { ...state, phase: "untap" },
    {
      ...active,
      landsPlayedThisTurn: 0,
      battlefield: active.battlefield.map((card) => ({
        ...card,
        tapped: false,
        // Anything that was already there at the start of this turn has
        // been under its controller's control long enough to attack.
        summoningSick: false,
      })),
    }
  );
}

/**
 * Draw step: the active player draws a card. The player going first skips
 * their very first draw. Drawing from an empty library loses the game.
 */
function drawStep(state: GameState): GameState {
  const base: GameState = { ...state, phase: "draw" };

  // Turn 1 is always the first player's first turn.
  if (base.turnNumber === 1) return base;

  const active = getPlayer(base, base.activePlayerId);
  if (active.library.length === 0) {
    return {
      ...base,
      status: "finished",
      winnerId: opponentOf(base, active.id).id,
      endReason: "decked",
    };
  }

  const [top, ...rest] = active.library; // library[0] is the top
  return replacePlayer(base, {
    ...active,
    hand: [...active.hand, top],
    library: rest,
  });
}

/**
 * Cleanup step: damage and "until end of turn" effects wear off at the same
 * moment, then the next player's turn begins.
 */
function cleanupStep(state: GameState): GameState {
  const cleaned = state.players.reduce(
    (current, player) =>
      replacePlayer(current, {
        ...player,
        battlefield: player.battlefield.map((card) => ({
          ...card,
          damageMarked: 0,
          powerModifier: 0,
          toughnessModifier: 0,
        })),
      }),
    { ...state, phase: "cleanup" as Phase }
  );

  const nextActive = opponentOf(cleaned, cleaned.activePlayerId);
  return enterStep(
    {
      ...cleaned,
      activePlayerId: nextActive.id,
      turnNumber: cleaned.turnNumber + 1,
    },
    "untap"
  );
}

/** Starts a step where players get priority, active player first. */
function givePriority(state: GameState, step: Phase): GameState {
  return {
    ...state,
    phase: step,
    priorityPlayerId: state.activePlayerId,
    consecutivePasses: 0,
  };
}

/**
 * Enters a step, runs its automatic actions, and hands out priority.
 *
 * Untap, upkeep, draw, and cleanup are AUTOMATIC: they run and move on with
 * no priority window, so a turn begins by landing straight in main phase 1.
 * Real Magic does give priority in upkeep and draw, but nothing can be cast
 * then yet, so those windows would only be dead clicks. When instants can be
 * cast (Week 4), this is the place to bring them back, or to replace it with
 * "auto-pass when a player has nothing legal to do."
 */
export function enterStep(state: GameState, step: Phase): GameState {
  switch (step) {
    case "untap":
      return enterStep(untapStep(state), "upkeep");
    case "upkeep":
      return enterStep({ ...state, phase: "upkeep" }, "draw");
    case "draw": {
      const afterDraw = drawStep(state);
      return afterDraw.status === "finished" ? afterDraw : enterStep(afterDraw, "main1");
    }
    case "cleanup":
      return cleanupStep(state);
    default:
      return givePriority(state, step);
  }
}

/** Begins turn 1. Called once both players have kept their hands. */
export function startFirstTurn(state: GameState): GameState {
  return enterStep(state, "untap");
}

// ---------- moving between steps ----------

function nextStep(state: GameState): Phase {
  if (state.phase === "declare_attackers") {
    const active = getPlayer(state, state.activePlayerId);
    if (!active.battlefield.some((card) => card.attacking)) {
      return "end_of_combat"; // nobody attacked: no blockers, no damage
    }
  }
  return STEP_ORDER[STEP_ORDER.indexOf(state.phase) + 1];
}

// ---------- priority ----------

export function passPriority(state: GameState, playerId: string): TurnResult {
  if (state.status !== "in_progress") {
    return { ok: false, reason: "The game isn't in progress." };
  }
  if (state.priorityPlayerId !== playerId) {
    return { ok: false, reason: "You don't have priority." };
  }
  const passes = state.consecutivePasses + 1;

  // First pass: the other player gets a chance to act.
  if (passes < 2) {
    return {
      ok: true,
      state: {
        ...state,
        consecutivePasses: passes,
        priorityPlayerId: opponentOf(state, playerId).id,
      },
    };
  }

  // Both passed in a row with something on the stack: the top object
  // resolves, the step does NOT end, and the active player gets priority.
  if (state.stack.length > 0) {
    const resolved = resolveTopOfStack(state);
    return {
      ok: true,
      state: {
        ...resolved,
        priorityPlayerId: resolved.activePlayerId,
        consecutivePasses: 0,
      },
    };
  }

  // Both passed in a row with an empty stack: the step ends.
  return { ok: true, state: enterStep(state, nextStep(state)) };
}