/**
 * stack.ts
 *
 * Resolving the stack. Convention: the TOP of the stack is the LAST element
 * of GameState.stack, so casting is a push and resolving is a pop.
 *
 * Right now this resolves permanent spells (creatures, artifacts, and so
 * on), which enter the battlefield. Instants and sorceries can't be cast
 * yet; if one ever got here it would just go to its owner's graveyard,
 * because spell effects arrive next week. Triggered abilities arrive in
 * Week 6.
 */

import type {
  BattlefieldCard,
  CardInstance,
  GameState,
  StackObject,
} from "../../../shared/src/types";
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
      attacking: false,
    };
    return replacePlayer(state, {
      ...controller,
      battlefield: [...controller.battlefield, permanent],
    });
  }

  // Instants and sorceries: effects aren't implemented yet.
  const owner = getPlayer(state, card.ownerId);
  return replacePlayer(state, { ...owner, graveyard: [...owner.graveyard, card] });
}

/** Removes the top object from the stack and resolves it. */
export function resolveTopOfStack(state: GameState): GameState {
  const top = state.stack[state.stack.length - 1];
  if (!top) return state;

  const withoutTop: GameState = { ...state, stack: state.stack.slice(0, -1) };

  if (top.kind === "spell") return resolveSpell(withoutTop, top);
  return withoutTop; // triggered abilities: Week 6
}