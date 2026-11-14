/**
 * combat.ts
 *
 * Combat, as pure functions over GameState.
 *
 * Flow (driven by turns.ts):
 *   declare_attackers   the active player picks attackers (GameState.awaiting
 *                       is "attackers" until they do; nobody has priority)
 *   declare_blockers    the defender assigns blockers (awaiting "blockers")
 *   first_strike_damage only if a creature in combat has first strike
 *   combat_damage       everyone else deals damage
 *   end_of_combat       combat flags are cleared
 *
 * Damage within a step is SIMULTANEOUS: every hit is worked out from the
 * state at the start of the step, then all of them are applied.
 *
 * v1 limits (deliberate):
 *   - Each attacker can be blocked by only ONE creature. Multiple blockers
 *     need a blocker ordering and a damage split, which is a lot of UI for an
 *     uncommon case.
 *   - Attackers can only attack players (there are no planeswalkers).
 *   - No double strike.
 *
 * Deathtouch: damage from a deathtouch source to a creature is recorded as
 * lethal (damage marked is raised to at least the creature's toughness), and
 * state-based actions then destroy it.
 */

import type { BattlefieldCard, GameState } from "../../../shared/src/types";
import { hasKeyword } from "./keywords";
import {
  effectivePower,
  effectiveToughness,
  updatePermanent,
} from "./permanents";
import { getPlayer, opponentOf, replacePlayer } from "./stateHelpers";

export type CombatResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

export type BlockAssignment = { blockerId: string; attackerId: string };

function fail(reason: string): CombatResult {
  return { ok: false, reason };
}

const isCreature = (permanent: BattlefieldCard) => permanent.card.types.includes("Creature");

// ---------- who can attack and block ----------

export function canAttack(creature: BattlefieldCard): boolean {
  if (!isCreature(creature) || creature.tapped) return false;
  if (hasKeyword(creature.card, "defender")) return false;
  if (creature.summoningSick && !hasKeyword(creature.card, "haste")) return false;
  return true;
}

/** Can `blocker` legally block `attacker`? Flying attackers need flying or reach. */
export function canBlock(blocker: BattlefieldCard, attacker: BattlefieldCard): boolean {
  if (!isCreature(blocker) || blocker.tapped) return false;
  if (
    hasKeyword(attacker.card, "flying") &&
    !hasKeyword(blocker.card, "flying") &&
    !hasKeyword(blocker.card, "reach")
  ) {
    return false;
  }
  return true;
}

export function eligibleAttackers(state: GameState): BattlefieldCard[] {
  return getPlayer(state, state.activePlayerId).battlefield.filter(canAttack);
}

/** Defending creatures that could block at least one of the current attackers. */
export function eligibleBlockers(state: GameState): BattlefieldCard[] {
  const attackers = getPlayer(state, state.activePlayerId).battlefield.filter(
    (p) => p.attacking
  );
  const defender = opponentOf(state, state.activePlayerId);
  return defender.battlefield.filter((blocker) =>
    attackers.some((attacker) => canBlock(blocker, attacker))
  );
}

// ---------- declarations ----------

export function declareAttackers(
  state: GameState,
  playerId: string,
  attackerIds: string[]
): CombatResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");
  if (state.awaiting !== "attackers") return fail("You aren't being asked to declare attackers.");
  if (playerId !== state.activePlayerId) return fail("Only the active player declares attackers.");
  if (new Set(attackerIds).size !== attackerIds.length) {
    return fail("A creature can only be declared once.");
  }

  const player = getPlayer(state, playerId);
  for (const id of attackerIds) {
    const creature = player.battlefield.find((p) => p.instanceId === id);
    if (!creature) return fail("One of those creatures isn't yours.");
    if (!canAttack(creature)) return fail(`${creature.card.name} can't attack.`);
  }

  const chosen = new Set(attackerIds);
  const updated = replacePlayer(state, {
    ...player,
    battlefield: player.battlefield.map((p) =>
      chosen.has(p.instanceId)
        ? {
            ...p,
            attacking: true,
            // Attacking taps a creature, unless it has vigilance.
            tapped: hasKeyword(p.card, "vigilance") ? p.tapped : true,
          }
        : p
    ),
  });

  // The declaration is made; now the active player gets priority.
  return {
    ok: true,
    state: {
      ...updated,
      awaiting: null,
      priorityPlayerId: updated.activePlayerId,
      consecutivePasses: 0,
    },
  };
}

export function declareBlockers(
  state: GameState,
  playerId: string,
  blocks: BlockAssignment[]
): CombatResult {
  if (state.status !== "in_progress") return fail("The game isn't in progress.");
  if (state.awaiting !== "blockers") return fail("You aren't being asked to declare blockers.");

  const attackerSide = getPlayer(state, state.activePlayerId);
  const defenderSide = opponentOf(state, state.activePlayerId);
  if (playerId !== defenderSide.id) return fail("Only the defending player declares blockers.");

  if (new Set(blocks.map((b) => b.blockerId)).size !== blocks.length) {
    return fail("A creature can only block once.");
  }
  if (new Set(blocks.map((b) => b.attackerId)).size !== blocks.length) {
    return fail("Each attacker can only be blocked by one creature for now.");
  }

  for (const { blockerId, attackerId } of blocks) {
    const blocker = defenderSide.battlefield.find((p) => p.instanceId === blockerId);
    if (!blocker) return fail("One of those blockers isn't yours.");

    const attacker = attackerSide.battlefield.find((p) => p.instanceId === attackerId);
    if (!attacker || !attacker.attacking) return fail("You can only block an attacking creature.");

    if (!canBlock(blocker, attacker)) {
      return fail(`${blocker.card.name} can't block ${attacker.card.name}.`);
    }
  }

  const blockerFor = new Map(blocks.map((b) => [b.attackerId, b.blockerId]));
  const attackerFor = new Map(blocks.map((b) => [b.blockerId, b.attackerId]));

  let next = replacePlayer(state, {
    ...attackerSide,
    battlefield: attackerSide.battlefield.map((p) =>
      blockerFor.has(p.instanceId) ? { ...p, blockedBy: blockerFor.get(p.instanceId) } : p
    ),
  });
  next = replacePlayer(next, {
    ...defenderSide,
    battlefield: defenderSide.battlefield.map((p) =>
      attackerFor.has(p.instanceId)
        ? { ...p, blockingInstanceId: attackerFor.get(p.instanceId) }
        : p
    ),
  });

  return {
    ok: true,
    state: {
      ...next,
      awaiting: null,
      priorityPlayerId: next.activePlayerId,
      consecutivePasses: 0,
    },
  };
}

// ---------- damage ----------

/** Does any creature in combat have first strike? */
export function hasFirstStrikeInCombat(state: GameState): boolean {
  return state.players.some((player) =>
    player.battlefield.some(
      (p) =>
        (p.attacking || p.blockingInstanceId !== undefined) &&
        hasKeyword(p.card, "first strike")
    )
  );
}

type Hit = {
  source: BattlefieldCard;
  to: { playerId: string } | { permanentId: string };
  amount: number;
};

/** The damage needed to be lethal to `blocker`, counting damage already on it. */
function lethalDamage(blocker: BattlefieldCard, attacker: BattlefieldCard): number {
  if (hasKeyword(attacker.card, "deathtouch")) return 1;
  return Math.max(0, effectiveToughness(blocker) - blocker.damageMarked);
}

/**
 * Deals one step of combat damage. In the first strike step only creatures
 * with first strike deal damage; in the regular step, only creatures WITHOUT
 * it do (the others already dealt theirs).
 */
export function dealCombatDamage(
  state: GameState,
  step: "first_strike" | "regular"
): GameState {
  const active = getPlayer(state, state.activePlayerId);
  const defender = opponentOf(state, active.id);
  const deals = (p: BattlefieldCard) =>
    hasKeyword(p.card, "first strike") === (step === "first_strike");

  // 1. Work out every hit from the state as it is right now.
  const hits: Hit[] = [];
  for (const attacker of active.battlefield) {
    if (!attacker.attacking) continue;

    const power = effectivePower(attacker);
    const blocker =
      attacker.blockedBy !== undefined
        ? defender.battlefield.find((b) => b.instanceId === attacker.blockedBy)
        : undefined;
    const trample = hasKeyword(attacker.card, "trample");

    if (deals(attacker) && power > 0) {
      if (attacker.blockedBy === undefined) {
        // Unblocked: all the damage goes to the defending player.
        hits.push({ source: attacker, to: { playerId: defender.id }, amount: power });
      } else if (blocker) {
        if (trample) {
          // Assign lethal damage to the blocker, the rest to the player.
          const toBlocker = Math.min(power, lethalDamage(blocker, attacker));
          if (toBlocker > 0) {
            hits.push({ source: attacker, to: { permanentId: blocker.instanceId }, amount: toBlocker });
          }
          if (power - toBlocker > 0) {
            hits.push({ source: attacker, to: { playerId: defender.id }, amount: power - toBlocker });
          }
        } else {
          hits.push({ source: attacker, to: { permanentId: blocker.instanceId }, amount: power });
        }
      } else if (trample) {
        // Blocked, but the blocker is gone: a trampler hits the player.
        hits.push({ source: attacker, to: { playerId: defender.id }, amount: power });
      }
      // Blocked, blocker gone, no trample: no damage is dealt.
    }

    // The blocker (if it's still there) hits back.
    if (blocker && deals(blocker)) {
      const blockerPower = effectivePower(blocker);
      if (blockerPower > 0) {
        hits.push({ source: blocker, to: { permanentId: attacker.instanceId }, amount: blockerPower });
      }
    }
  }

  // 2. Apply them all.
  let next = state;
  for (const hit of hits) {
    if ("playerId" in hit.to) {
      const player = getPlayer(next, hit.to.playerId);
      next = replacePlayer(next, { ...player, life: player.life - hit.amount });
    } else {
      const deathtouch = hasKeyword(hit.source.card, "deathtouch");
      next = updatePermanent(next, hit.to.permanentId, (p) => {
        const damage = p.damageMarked + hit.amount;
        return {
          ...p,
          damageMarked: deathtouch ? Math.max(damage, effectiveToughness(p)) : damage,
        };
      });
    }

    if (hasKeyword(hit.source.card, "lifelink")) {
      const controller = getPlayer(next, hit.source.controllerId);
      next = replacePlayer(next, { ...controller, life: controller.life + hit.amount });
    }
  }
  return next;
}

/** At the end of combat, every creature is removed from combat. */
export function clearCombat(state: GameState): GameState {
  return state.players.reduce(
    (current, player) =>
      replacePlayer(current, {
        ...player,
        battlefield: player.battlefield.map((p) => ({
          ...p,
          attacking: false,
          blockingInstanceId: undefined,
          blockedBy: undefined,
        })),
      }),
    state
  );
}

// ---------- validating data from the network ----------

export function isBlockAssignment(value: unknown): value is BlockAssignment {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.blockerId === "string" && typeof v.attackerId === "string";
}