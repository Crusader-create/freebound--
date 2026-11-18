/**
 * stack.ts
 *
 * Resolving the stack. Convention: the TOP of the stack is the LAST element
 * of GameState.stack, so casting is a push and resolving is a pop.
 *
 *   - Permanent spells (creatures, etc.) enter the battlefield.
 *   - Instants and sorceries apply their effect, then go to their owner's
 *     graveyard. If the target is no longer legal by the time the spell
 *     resolves, the spell "fizzles": it does nothing, but still goes to the
 *     graveyard.
 *   - When a creature enters the battlefield, its "enters" trigger (if any)
 *     is QUEUED in pendingTriggers. It goes on the stack later, after
 *     state-based actions (see engine.ts), not immediately.
 *   - Triggered abilities resolve through triggers.ts.
 */

import { randomUUID } from "crypto";
import type {
  BattlefieldCard,
  CardInstance,
  GameState,
  StackObject,
  Target,
} from "../../../shared/src/types";
import { applyEffect, effectTargetSpec, getSpellEffect, targetProblem } from "./effects";
import { log, p, P } from "./log";
import { findPermanent } from "./permanents";
import { getPlayer, replacePlayer } from "./stateHelpers";
import {
  describeTrigger,
  getEtbTrigger,
  resolveTrigger,
  triggerNeedsTarget,
} from "./triggers";

const PERMANENT_TYPES = ["Creature", "Artifact", "Enchantment", "Planeswalker", "Battle"];

function isPermanentSpell(card: CardInstance): boolean {
  return card.card.types.some((type) => PERMANENT_TYPES.includes(type));
}

function resolveSpell(state: GameState, spell: StackObject): GameState {
  const card = spell.source;

  if (isPermanentSpell(card)) {
    const controller = getPlayer(state, spell.controllerId);
    const permanent: BattlefieldCard = {
      ...card,
      controllerId: controller.id,
      tapped: false,
      // A creature can't attack or use {T} abilities until its controller
      // has controlled it since the start of one of their turns.
      summoningSick: card.card.types.includes("Creature"),
      damageMarked: 0,
      powerModifier: 0,
      toughnessModifier: 0,
      attacking: false,
    };
    const entered = log(
      replacePlayer(state, {
        ...controller,
        battlefield: [...controller.battlefield, permanent],
      }),
      `${P(controller.id)} ${card.card.name} entered the battlefield.`
    );

    // The creature's "enters" trigger, if it has one, is queued: it will be
    // put on the stack after state-based actions, not resolved right now.
    const trigger = getEtbTrigger(card.card);
    if (!trigger) return entered;
    return {
      ...entered,
      pendingTriggers: [
        ...entered.pendingTriggers,
        {
          controllerId: controller.id,
          source: card,
          description: describeTrigger(card.card, trigger),
          needsTarget: triggerNeedsTarget(trigger),
        },
      ],
    };
  }

  // Instant or sorcery: apply the effect if the target is still legal.
  let next = state;
  const effect = getSpellEffect(card.card);
  const target = spell.targets[0];
  const name = card.card.name;
  if (effect && target && targetProblem(next, effectTargetSpec(effect), target) === null) {
    const what = describeTargetNow(next, target);
    next = applyEffect(next, effect, target);
    switch (effect.kind) {
      case "damage":
        next = log(next, `${name} dealt ${effect.amount} damage to ${what}.`);
        break;
      case "pump": {
        const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
        next = log(next, `${what} got ${sign(effect.power)}/${sign(effect.toughness)} until end of turn.`);
        break;
      }
      case "destroy":
        next = log(next, `${name} destroyed ${what}.`);
        break;
    }
  } else {
    // The target is gone or illegal: the spell fizzles.
    next = log(next, `${name} had no legal target and did nothing.`);
  }

  const owner = getPlayer(next, card.ownerId);
  return replacePlayer(next, { ...owner, graveyard: [...owner.graveyard, card] });
}

/** A target as it reads in the log, looked up at resolution time. */
function describeTargetNow(state: GameState, target: Target): string {
  if (target.kind === "player") return p(target.playerId);
  if (target.kind === "permanent") {
    const found = findPermanent(state, target.instanceId);
    return found ? `${P(found.controller.id)} ${found.permanent.card.name}` : "a creature";
  }
  return "a spell";
}

/** Removes the top object from the stack and resolves it. */
export function resolveTopOfStack(state: GameState): GameState {
  const top = state.stack[state.stack.length - 1];
  if (!top) return state;

  const withoutTop: GameState = { ...state, stack: state.stack.slice(0, -1) };

  if (top.kind === "spell") return resolveSpell(withoutTop, top);
  return resolveTrigger(withoutTop, top, randomUUID);
}