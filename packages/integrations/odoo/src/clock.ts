export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
