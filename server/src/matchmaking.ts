/**
 * matchmaking.ts
 *
 * Plain first-come-first-served matchmaking: the first two players waiting
 * get paired. No skill or rank matching.
 *
 * Players are identified by their playerId (from their session), not their
 * socket, so a reconnecting player is the same player.
 */

import type { ValidatedCard } from "./cards/validateDeck";

export type QueueEntry = {
  playerId: string;
  deck: ValidatedCard[];
};

export class MatchmakingQueue {
  private waiting: QueueEntry[] = [];

  has(playerId: string): boolean {
    return this.waiting.some((entry) => entry.playerId === playerId);
  }

  /**
   * Adds a player to the queue. If someone is already waiting, returns that
   * waiting player (the match). Otherwise returns null and the new player
   * waits. Joining twice is a no-op.
   */
  join(entry: QueueEntry): QueueEntry | null {
    if (this.has(entry.playerId)) return null;

    const opponent = this.waiting.shift();
    if (opponent) return opponent;

    this.waiting.push(entry);
    return null;
  }

  leave(playerId: string): void {
    this.waiting = this.waiting.filter((entry) => entry.playerId !== playerId);
  }
}