import { type Clock, systemClock } from "./clock";

export type RateLimiter = {
  run<T>(task: () => Promise<T>): Promise<T>;
};

export function createRateLimiter(ratePerSecond: number, clock: Clock = systemClock): RateLimiter {
  const intervalMs = ratePerSecond > 0 ? 1000 / ratePerSecond : 0;
  let tail: Promise<unknown> = Promise.resolve();
  let nextAt = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        if (intervalMs > 0) {
          const wait = nextAt - clock.now();
          if (wait > 0) await clock.sleep(wait);
          nextAt = clock.now() + intervalMs;
        }
        return task();
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
