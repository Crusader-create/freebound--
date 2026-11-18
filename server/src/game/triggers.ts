/**
 * triggers.ts
 *
 * Triggered abilities. Like spell effects and keywords, a card's trigger is
 * READ from its oracle text. Only "enters the battlefield" (ETB) triggers
 * exist in the pool, with four effects:
 *
 *   "When this creature enters, draw a card."                   Helpful Hunter
 *   "When this creature enters, you gain 2 life."               Primordial Pachyderm
 *   "When this creature enters, it deals 1 damage to any target."  Skeleton Archer
 *   "When this creature enters, create a 1/1 white Cat creature token."  Prideful Parent
 *                                                                Elder Auntie
 *
 * How a trigger moves through the game (see the comments in engine.ts):
 *   1. A creature enters the battlefield (stack.ts). Its trigger is READ and
 *      added to GameState.pendingTriggers. Nothing happens yet.
 *   2. After state-based actions, the engine moves pending triggers onto the
 *      stack as "triggered_ability" objects. A trigger that needs a target
 *      first waits for its controller to choose one (awaiting = "trigger_target").
 *   3. The trigger resolves like a spell when both players pass. Either
 *      player may respond to it first.
 */

import type {
  BattlefieldCard,
  Card,
  CardInstance,
  GameState,
  StackObject,
  Target,
} from "../../../shared/src/types";
import { applyEffect, targetProblem } from "./effects";
import { log, p, P } from "./log";
import { findPermanent } from "./permanents";
import { getPlayer, replacePlayer } from "./stateHelpers";

export type TriggerEffect =
  | { kind: "draw"; count: number }
  | { kind: "gain_life"; amount: number }
  | { kind: "damage"; amount: number } // to any target
  | { kind: "token"; power: number; toughness: number; name: string };

// ---------- reading triggers from oracle text ----------

const ETB_PREFIX = /^when (?:this creature|[^,]+?) enters(?: the battlefield)?, (.+)$/i;
const DRAW = /^draw (a|\d+) cards?\.?$/i;
const GAIN_LIFE = /^you gain (\d+) life\.?$/i;
const DAMAGE = /^(?:it|this creature) deals (\d+) damage to any target\.?$/i;
// "create a 1/1 white Cat creature token." / "create a 1/1 black and red Goblin creature token."
const TOKEN = /^create an? (\d+)\/(\d+) (?:[\w ]+ )?([A-Z][\w]*) creature token\.?$/i;

/** The ETB trigger on this card, or null if it has none we support. */
export function getEtbTrigger(card: Card): TriggerEffect | null {
  const lines = card.oracleText
    .replace(/\([^)]*\)/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const line of lines) {
    const etb = ETB_PREFIX.exec(line);
    if (!etb) continue;
    const effectText = etb[1];

    const draw = DRAW.exec(effectText);
    if (draw) return { kind: "draw", count: draw[1] === "a" ? 1 : parseInt(draw[1], 10) };

    const gain = GAIN_LIFE.exec(effectText);
    if (gain) return { kind: "gain_life", amount: parseInt(gain[1], 10) };

    const damage = DAMAGE.exec(effectText);
    if (damage) return { kind: "damage", amount: parseInt(damage[1], 10) };

    const token = TOKEN.exec(effectText);
    if (token) {
      return {
        kind: "token",
        power: parseInt(token[1], 10),
        toughness: parseInt(token[2], 10),
        name: token[3],
      };
    }

    return null; // an ETB line we don't understand: unsupported
  }
  return null;
}

export function triggerNeedsTarget(effect: TriggerEffect): boolean {
  return effect.kind === "damage";
}

export function describeTrigger(card: Card, effect: TriggerEffect): string {
  switch (effect.kind) {
    case "draw":
      return `${card.name}: draw ${effect.count === 1 ? "a card" : `${effect.count} cards`}`;
    case "gain_life":
      return `${card.name}: gain ${effect.amount} life`;
    case "damage":
      return `${card.name}: ${effect.amount} damage to any target`;
    case "token":
      return `${card.name}: create a ${effect.power}/${effect.toughness} ${effect.name} token`;
  }
}

// ---------- tokens ----------

/**
 * A token is a creature with no card behind it. We give it a made-up Card
 * so the rest of the engine can treat it like any other permanent. Tokens
 * that leave the battlefield just vanish (see destroyPermanent's caller).
 */
export function makeToken(
  controllerId: string,
  instanceId: string,
  effect: Extract<TriggerEffect, { kind: "token" }>
): BattlefieldCard {
  return {
    instanceId,
    ownerId: controllerId,
    controllerId,
    card: {
      scryfallId: `token:${effect.name.toLowerCase()}`,
      name: `${effect.name} token`,
      manaCost: "",
      types: ["Token", "Creature", effect.name],
      power: effect.power,
      toughness: effect.toughness,
      oracleText: "",
      imageUrl: "",
    },
    tapped: false,
    summoningSick: true,
    damageMarked: 0,
    powerModifier: 0,
    toughnessModifier: 0,
    attacking: false,
  };
}

export function isToken(card: CardInstance): boolean {
  return card.card.types.includes("Token");
}

// ---------- resolving a trigger ----------

/**
 * Resolves a triggered ability that's on the stack. Returns the new state.
 * `newId` supplies a unique id when a token has to be created.
 */
export function resolveTrigger(
  state: GameState,
  trigger: StackObject,
  newId: () => string
): GameState {
  const effect = getEtbTrigger(trigger.source.card);
  if (!effect) return state;
  const controller = getPlayer(state, trigger.controllerId);
  const name = trigger.source.card.name;

  switch (effect.kind) {
    case "draw": {
      const drawn = controller.library.slice(0, effect.count);
      const cards = drawn.length === 1 ? "a card" : `${drawn.length} cards`;
      return log(
        replacePlayer(state, {
          ...controller,
          hand: [...controller.hand, ...drawn],
          library: controller.library.slice(effect.count),
        }),
        `${name}: ${p(controller.id)} drew ${cards}.`
      );
      // Drawing from an empty library here doesn't lose the game until the
      // draw step; that matches the simplified SBA set we have for now.
    }

    case "gain_life":
      return log(
        replacePlayer(state, { ...controller, life: controller.life + effect.amount }),
        `${name}: ${p(controller.id)} gained ${effect.amount} life.`
      );

    case "damage": {
      const target: Target | undefined = trigger.targets[0];
      // If the target is gone, the ability fizzles.
      if (!target || targetProblem(state, "any", target) !== null) {
        return log(state, `${name}'s ability had no legal target and did nothing.`);
      }
      const what = describeTargetForLog(state, target);
      return log(
        applyEffect(state, { kind: "damage", amount: effect.amount, target: "any" }, target),
        `${name} dealt ${effect.amount} damage to ${what}.`
      );
    }

    case "token":
      return log(
        replacePlayer(state, {
          ...controller,
          battlefield: [...controller.battlefield, makeToken(controller.id, newId(), effect)],
        }),
        `${name}: ${p(controller.id)} created a ${effect.power}/${effect.toughness} ${effect.name} token.`
      );
  }
}

function describeTargetForLog(state: GameState, target: Target): string {
  if (target.kind === "player") return p(target.playerId);
  if (target.kind === "permanent") {
    const found = findPermanent(state, target.instanceId);
    return found ? `${P(found.controller.id)} ${found.permanent.card.name}` : "a creature";
  }
  return "a spell";
}