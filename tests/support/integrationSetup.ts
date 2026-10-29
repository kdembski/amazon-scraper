import { afterEach, beforeEach, vi } from "vitest";
import { cronJobs } from "@@tests/support/cron";

// Crons are triggered by hand through cronJobs
vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

// Retries go out right away, so a country can fail MAX_FAILED_ATTEMPTS times within a test
vi.mock("@/shared/utils/retry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/utils/retry")>()),
  getRetryDelay: () => 0,
}));

// Batches go out on the next tick instead of after 5 s
vi.mock("@/shared/backend/BatchSender", async (importOriginal) => {
  const { BatchSender } = await importOriginal<typeof import("@/shared/backend/BatchSender")>();
  return {
    BatchSender: class<T> extends BatchSender<T> {
      constructor(...[path, toBody, maxSize, , ...rest]: ConstructorParameters<typeof BatchSender<T>>) {
        super(path, toBody, maxSize, 0, ...rest);
      }
    },
  };
});

// Retry sleeps (0 ms) run at once; longer ones, like the PDP loop, wait on a
// fake interval, so a test advances them like the queue stats and they stop
// for good once the fake timers are dropped
vi.mock("@/shared/utils/sleep", () => ({
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      if (!ms) {
        setTimeout(resolve, 0);
        return;
      }
      const id = setInterval(() => {
        clearInterval(id);
        resolve();
      }, ms);
    }),
}));

beforeEach(() => {
  // Only intervals are fake: the PDP loop and queue stats run when a test
  // advances them, while the queue, retries and sockets use real time
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  cronJobs.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
