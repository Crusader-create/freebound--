/**
 * permanents.ts
 *
 * Helpers for working with permanents on the battlefield. All of them
 * return NEW states; nothing is mutated.
 */

import type { BattlefieldCard, GameState, Player } from "../../../shared/src/types";
import { getPlayer, replacePlayer } from "./stateHelpers";

export function effectivePower(permanent: BattlefieldCard): number {
  return (permanent.card.power ?? 0) + permanent.powerModifier;
}

export function effectiveToughness(permanent: BattlefieldCard): number {
  return (permanent.card.toughness ?? 0) + permanent.toughnessModifier;
}

/** Finds a permanent on either player's battlefield. */
export function findPermanent(
  state: GameState,
  instanceId: string
): { controller: Player; permanent: BattlefieldCard } | undefined {
  for (const controller of state.players) {
    const permanent = controller.battlefield.find((p) => p.instanceId === instanceId);
    if (permanent) return { controller, permanent };
  }
  return undefined;
}

/** Applies `change` to one permanent. Does nothing if it isn't on the battlefield. */
export function updatePermanent(
  state: GameState,
  instanceId: string,
  change: (permanent: BattlefieldCard) => BattlefieldCard
): GameState {
  const found = findPermanent(state, instanceId);
  if (!found) return state;

  return replacePlayer(state, {
    ...found.controller,
    battlefield: found.controller.battlefield.map((p) =>
      p.instanceId === instanceId ? change(p) : p
    ),
  });
}

/** Moves a permanent from the battlefield to its OWNER's graveyard. */
export function destroyPermanent(state: GameState, instanceId: string): GameState {
  const found = findPermanent(state, instanceId);
  if (!found) return state;

  const { instanceId: id, card, ownerId } = found.permanent;
  const withoutIt = replacePlayer(state, {
    ...found.controller,
    battlefield: found.controller.battlefield.filter((p) => p.instanceId !== instanceId),
  });

  const owner = getPlayer(withoutIt, ownerId);
  return replacePlayer(withoutIt, {
    ...owner,
    graveyard: [...owner.graveyard, { instanceId: id, card, ownerId }],
  });
}