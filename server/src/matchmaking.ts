/**
 * matchmaking.ts
 *
 * Plain first-come-first-served matchmaking: the first two players waiting
 * get paired. No skill or rank matching.
 */

import type { ValidatedCard } from "./cards/validateDeck";

export type QueueEntry = {
  socketId: string;
  deck: ValidatedCard[];
};

export class MatchmakingQueue {
  private waiting: QueueEntry[] = [];

  has(socketId: string): boolean {
    return this.waiting.some((entry) => entry.socketId === socketId);
  }

  /**
   * Adds a player to the queue. If someone is already waiting, returns that
   * waiting player (the match). Otherwise returns null and the new player
   * waits. Joining twice is a no-op.
   */
  join(entry: QueueEntry): QueueEntry | null {
    if (this.has(entry.socketId)) return null;

    const opponent = this.waiting.shift();
    if (opponent) return opponent;

    this.waiting.push(entry);
    return null;
  }

  leave(socketId: string): void {
    this.waiting = this.waiting.filter((entry) => entry.socketId !== socketId);
  }
}