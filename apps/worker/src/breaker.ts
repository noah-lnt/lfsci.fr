import { logger } from "@lfsci/kernel";

const log = logger("worker.breaker");

export type BreakerState = "closed" | "open";

export type Breaker = {
  readonly name: string;
  state(now: number): BreakerState;
  /** Only a failure proving the resource itself is down (SYN-06, GLA breaker lesson). */
  recordTransportFailure(now: number): void;
  recordSuccess(): void;
  /** A refusal of one item says nothing about the resource; it never trips the breaker. */
  recordBusinessRejection(): void;
  consecutiveFailures(): number;
  openUntil(): number | null;
};

export type BreakerOptions = { name: string; threshold: number; cooldownMs: number };

export function createBreaker(options: BreakerOptions): Breaker {
  let consecutive = 0;
  let openedUntil: number | null = null;

  return {
    name: options.name,

    state(now) {
      if (openedUntil === null) return "closed";
      if (now >= openedUntil) {
        openedUntil = null;
        consecutive = 0;
        return "closed";
      }
      return "open";
    },

    recordTransportFailure(now) {
      consecutive += 1;
      if (consecutive >= options.threshold) {
        openedUntil = now + options.cooldownMs;
        log.error(
          { breaker: options.name, consecutive, cooldownMs: options.cooldownMs },
          "circuit breaker opened on consecutive transport failures",
        );
      }
    },

    recordSuccess() {
      consecutive = 0;
      openedUntil = null;
    },

    recordBusinessRejection() {},

    consecutiveFailures: () => consecutive,
    openUntil: () => openedUntil,
  };
}
