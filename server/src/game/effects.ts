/**
 * effects.ts
 *
 * Spell effects for instants and sorceries. Rather than hand-writing code
 * per card, each card's effect is READ from its oracle text, the same way
 * mana abilities are. Three reusable effect types cover the whole pool:
 *
 *   damage   "Shock deals 2 damage to any target."
 *   pump     "Target creature gets +3/+3 until end of turn." (or -X/-X)
 *   destroy  "Destroy target creature." / "...attacking or blocking creature."
 *
 * Anything that doesn't match exactly (modal, tiered, conditional, extra
 * sentences, color restrictions) returns null, which the engine treats as
 * "not supported yet". So a new card is only castable if its text is a
 * clean one-sentence version of one of the three types above.
 */

import type { Card, GameState, Target } from "../../../shared/src/types";
import { destroyPermanent, findPermanent, updatePermanent } from "./permanents";
import { findPlayer, getPlayer, replacePlayer } from "./stateHelpers";

export type TargetSpec =
  | "any" // a creature or a player
  | "creature"
  | "player"
  | "attacking_or_blocking_creature";

export type SpellEffect =
  | { kind: "damage"; amount: number; target: TargetSpec }
  | { kind: "pump"; power: number; toughness: number }
  | { kind: "destroy"; target: "creature" | "attacking_or_blocking_creature" };

// ---------- reading effects from oracle text ----------

// The leading [^.•—]+ keeps this to ONE sentence: text containing a period,
// a bullet, or a dash (modal, tiered, and multi-sentence spells) won't match.
const DAMAGE =
  /^[^.•—]+ deals (\d+) damage to (any target|target creature|target creature or planeswalker|target player or planeswalker)\.?$/i;
const PUMP = /^target creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i;
const DESTROY = /^destroy target (attacking or blocking )?creature\.?$/i;

const DAMAGE_TARGETS: Record<string, TargetSpec> = {
  "any target": "any",
  "target creature": "creature",
  "target creature or planeswalker": "creature", // there are no planeswalkers here
  "target player or planeswalker": "player",
};

/** The spell effect for this card, or null if it's missing or unsupported. */
export function getSpellEffect(card: Card): SpellEffect | null {
  const text = card.oracleText
    .replace(/\([^)]*\)/g, "") // reminder text
    .replace(/\s+/g, " ")
    .trim();

  const damage = DAMAGE.exec(text);
  if (damage) {
    return {
      kind: "damage",
      amount: parseInt(damage[1], 10),
      target: DAMAGE_TARGETS[damage[2].toLowerCase()],
    };
  }

  const pump = PUMP.exec(text);
  if (pump) {
    // "|| 0" turns "-0" into a plain 0.
    return {
      kind: "pump",
      power: parseInt(pump[1], 10) || 0,
      toughness: parseInt(pump[2], 10) || 0,
    };
  }

  const destroy = DESTROY.exec(text);
  if (destroy) {
    return {
      kind: "destroy",
      target: destroy[1] ? "attacking_or_blocking_creature" : "creature",
    };
  }

  return null;
}

/** What kind of target an effect needs. */
export function effectTargetSpec(effect: SpellEffect): TargetSpec {
  switch (effect.kind) {
    case "damage":
      return effect.target;
    case "pump":
      return "creature";
    case "destroy":
      return effect.target;
  }
}

// ---------- targets ----------

/** Runtime check for data arriving over the network. */
export function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "player":
      return typeof v.playerId === "string";
    case "permanent":
      return typeof v.instanceId === "string";
    case "stack":
      return typeof v.stackId === "string";
    default:
      return false;
  }
}

/**
 * Why `target` isn't legal for `spec`, or null if it is. Used both when
 * a spell is cast and again when it resolves (the target may be gone).
 */
export function targetProblem(
  state: GameState,
  spec: TargetSpec,
  target: Target
): string | null {
  switch (target.kind) {
    case "stack":
      return "Targeting spells isn't supported yet.";

    case "player":
      if (spec !== "any" && spec !== "player") {
        return "This spell can only target a creature.";
      }
      return findPlayer(state, target.playerId) ? null : "That player isn't in this game.";

    case "permanent": {
      if (spec === "player") return "This spell can only target a player.";

      const found = findPermanent(state, target.instanceId);
      if (!found) return "That target isn't on the battlefield.";
      if (!found.permanent.card.types.includes("Creature")) {
        return "That target isn't a creature.";
      }
      if (
        spec === "attacking_or_blocking_creature" &&
        !found.permanent.attacking &&
        found.permanent.blockingInstanceId === undefined
      ) {
        return "That creature isn't attacking or blocking.";
      }
      return null;
    }
  }
}

// ---------- applying effects ----------

/** Applies an effect to an already-validated target. */
export function applyEffect(
  state: GameState,
  effect: SpellEffect,
  target: Target
): GameState {
  switch (effect.kind) {
    case "damage": {
      if (target.kind === "player") {
        const player = getPlayer(state, target.playerId);
        return replacePlayer(state, { ...player, life: player.life - effect.amount });
      }
      if (target.kind === "permanent") {
        return updatePermanent(state, target.instanceId, (p) => ({
          ...p,
          damageMarked: p.damageMarked + effect.amount,
        }));
      }
      return state;
    }

    case "pump":
      if (target.kind !== "permanent") return state;
      return updatePermanent(state, target.instanceId, (p) => ({
        ...p,
        powerModifier: p.powerModifier + effect.power,
        toughnessModifier: p.toughnessModifier + effect.toughness,
      }));

    case "destroy":
      if (target.kind !== "permanent") return state;
      return destroyPermanent(state, target.instanceId);
  }
}