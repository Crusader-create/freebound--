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
import { log, p, P } from "./log";
import {
  effectivePower,
  effectiveToughness,
  findPermanent,
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

/**
 * Creatures enchanted by a Pacifism-style Aura: they can't attack or block.
 * (Pacifism is the only Aura the engine supports, so any attached Aura counts.)
 */
export function pacifiedIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const player of state.players) {
    for (const permanent of player.battlefield) {
      if (permanent.attachedTo) ids.add(permanent.attachedTo);
    }
  }
  return ids;
}

export function eligibleAttackers(state: GameState): BattlefieldCard[] {
  const pacified = pacifiedIds(state);
  return getPlayer(state, state.activePlayerId).battlefield.filter(
    (c) => canAttack(c) && !pacified.has(c.instanceId)
  );
}

/** Defending creatures that could block at least one of the current attackers. */
export function eligibleBlockers(state: GameState): BattlefieldCard[] {
  const attackers = getPlayer(state, state.activePlayerId).battlefield.filter(
    (p) => p.attacking
  );
  const defender = opponentOf(state, state.activePlayerId);
  const pacified = pacifiedIds(state);
  return defender.battlefield.filter(
    (blocker) =>
      !pacified.has(blocker.instanceId) && attackers.some((attacker) => canBlock(blocker, attacker))
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
    if (!canAttack(creature) || pacifiedIds(state).has(creature.instanceId)) {
      return fail(`${creature.card.name} can't attack.`);
    }
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

  const names = player.battlefield
    .filter((c) => chosen.has(c.instanceId))
    .map((c) => c.card.name)
    .join(", ");
  const line =
    attackerIds.length === 0
      ? `${p(playerId)} didn't attack.`
      : `${p(playerId)} attacked with ${names}.`;

  // The declaration is made; now the active player gets priority.
  return {
    ok: true,
    state: log(
      {
        ...updated,
        awaiting: null,
        priorityPlayerId: updated.activePlayerId,
        consecutivePasses: 0,
      },
      line
    ),
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

  for (const { blockerId, attackerId } of blocks) {
    const blocker = defenderSide.battlefield.find((p) => p.instanceId === blockerId);
    if (!blocker) return fail("One of those blockers isn't yours.");

    const attacker = attackerSide.battlefield.find((p) => p.instanceId === attackerId);
    if (!attacker || !attacker.attacking) return fail("You can only block an attacking creature.");

    if (pacifiedIds(state).has(blocker.instanceId)) return fail(`${blocker.card.name} can't block.`);
    if (!canBlock(blocker, attacker)) {
      return fail(`${blocker.card.name} can't block ${attacker.card.name}.`);
    }
  }

  // Several creatures may block the same attacker, so each attacker gets a list.
  const blockersFor = new Map<string, string[]>();
  for (const { blockerId, attackerId } of blocks) {
    blockersFor.set(attackerId, [...(blockersFor.get(attackerId) ?? []), blockerId]);
  }
  const attackerFor = new Map(blocks.map((b) => [b.blockerId, b.attackerId]));

  let next = replacePlayer(state, {
    ...attackerSide,
    battlefield: attackerSide.battlefield.map((p) =>
      blockersFor.has(p.instanceId) ? { ...p, blockedBy: blockersFor.get(p.instanceId) } : p
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

  const nameOf = (side: typeof defenderSide, id: string) =>
    side.battlefield.find((c) => c.instanceId === id)!.card.name;
  const lines = [...blockersFor].map(([attackerId, blockerIds]) => {
    const names = blockerIds.map((id) => nameOf(defenderSide, id));
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${who} blocked ${nameOf(attackerSide, attackerId)}`;
  });
  const line =
    blocks.length === 0 ? `${p(playerId)} didn't block.` : `${p(playerId)}: ${lines.join("; ")}.`;

  return {
    ok: true,
    state: log(
      {
        ...next,
        awaiting: null,
        priorityPlayerId: next.activePlayerId,
        consecutivePasses: 0,
      },
      line
    ),
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
 * Splits a blocked attacker's damage among its blockers, the way the attacking
 * player usually would: kill as many blockers as possible, cheapest first.
 * Each one gets lethal damage in turn. Anything left over goes to the player
 * if the attacker has trample, otherwise onto the last blocker it reached.
 * (Arena lets you divide this by hand; we pick the usual best split for you.)
 */
function assignAttackerDamage(
  attacker: BattlefieldCard,
  power: number,
  blockers: BattlefieldCard[],
  defenderId: string,
  trample: boolean
): Hit[] {
  const order = [...blockers].sort(
    (a, b) => lethalDamage(a, attacker) - lethalDamage(b, attacker)
  );
  const amounts = new Map<string, number>();
  let remaining = power;
  for (const blocker of order) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, lethalDamage(blocker, attacker));
    amounts.set(blocker.instanceId, amount);
    remaining -= amount;
  }

  const toPlayer = remaining > 0 && trample ? remaining : 0;
  if (remaining > 0 && !trample) {
    const last = order[order.length - 1].instanceId;
    amounts.set(last, (amounts.get(last) ?? 0) + remaining);
  }

  const hits: Hit[] = [];
  for (const blocker of order) {
    const amount = amounts.get(blocker.instanceId) ?? 0;
    if (amount > 0) hits.push({ source: attacker, to: { permanentId: blocker.instanceId }, amount });
  }
  if (toPlayer > 0) hits.push({ source: attacker, to: { playerId: defenderId }, amount: toPlayer });
  return hits;
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
    const blocked = attacker.blockedBy !== undefined;
    // Blockers that are still on the battlefield (some may have died or been removed).
    const blockers = (attacker.blockedBy ?? [])
      .map((id) => defender.battlefield.find((b) => b.instanceId === id))
      .filter((b): b is BattlefieldCard => b !== undefined);
    const trample = hasKeyword(attacker.card, "trample");

    if (deals(attacker) && power > 0) {
      if (!blocked) {
        // Unblocked: all the damage goes to the defending player.
        hits.push({ source: attacker, to: { playerId: defender.id }, amount: power });
      } else if (blockers.length > 0) {
        hits.push(...assignAttackerDamage(attacker, power, blockers, defender.id, trample));
      } else if (trample) {
        // Blocked, but every blocker is gone: a trampler hits the player.
        hits.push({ source: attacker, to: { playerId: defender.id }, amount: power });
      }
      // Blocked, blockers gone, no trample: no damage is dealt.
    }

    // Each blocker that's still there hits back.
    for (const blocker of blockers) {
      if (!deals(blocker)) continue;
      const blockerPower = effectivePower(blocker);
      if (blockerPower > 0) {
        hits.push({ source: blocker, to: { permanentId: attacker.instanceId }, amount: blockerPower });
      }
    }
  }

  // 2. Apply them all.
  let next = state;
  for (const hit of hits) {
    const source = hit.source.card.name;
    if ("playerId" in hit.to) {
      const player = getPlayer(next, hit.to.playerId);
      next = log(
        replacePlayer(next, { ...player, life: player.life - hit.amount }),
        `${source} dealt ${hit.amount} damage to ${p(player.id)}.`
      );
    } else {
      const deathtouch = hasKeyword(hit.source.card, "deathtouch");
      const victim = findPermanent(next, hit.to.permanentId);
      next = updatePermanent(next, hit.to.permanentId, (p) => {
        const damage = p.damageMarked + hit.amount;
        return {
          ...p,
          damageMarked: deathtouch ? Math.max(damage, effectiveToughness(p)) : damage,
        };
      });
      if (victim) {
        next = log(
          next,
          `${source} dealt ${hit.amount} damage to ${P(victim.controller.id)} ${victim.permanent.card.name}.`
        );
      }
    }

    if (hasKeyword(hit.source.card, "lifelink")) {
      const controller = getPlayer(next, hit.source.controllerId);
      next = log(
        replacePlayer(next, { ...controller, life: controller.life + hit.amount }),
        `${source}'s lifelink: ${p(controller.id)} gained ${hit.amount} life.`
      );
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