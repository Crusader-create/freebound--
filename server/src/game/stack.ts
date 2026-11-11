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
 *
 * Triggered abilities arrive in Week 6.
 */

import type {
  BattlefieldCard,
  CardInstance,
  GameState,
  StackObject,
} from "../../../shared/src/types";
import { applyEffect, effectTargetSpec, getSpellEffect, targetProblem } from "./effects";
import { getPlayer, replacePlayer } from "./stateHelpers";

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
    return replacePlayer(state, {
      ...controller,
      battlefield: [...controller.battlefield, permanent],
    });
  }

  // Instant or sorcery: apply the effect if the target is still legal.
  let next = state;
  const effect = getSpellEffect(card.card);
  const target = spell.targets[0];
  if (effect && target && targetProblem(next, effectTargetSpec(effect), target) === null) {
    next = applyEffect(next, effect, target);
  }
  // (If the target was illegal the spell fizzles: no effect, same graveyard.)

  const owner = getPlayer(next, card.ownerId);
  return replacePlayer(next, { ...owner, graveyard: [...owner.graveyard, card] });
}

/** Removes the top object from the stack and resolves it. */
export function resolveTopOfStack(state: GameState): GameState {
  const top = state.stack[state.stack.length - 1];
  if (!top) return state;

  const withoutTop: GameState = { ...state, stack: state.stack.slice(0, -1) };

  if (top.kind === "spell") return resolveSpell(withoutTop, top);
  return withoutTop; // triggered abilities: Week 6
}