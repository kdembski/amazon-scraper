import { afterEach, beforeEach, vi } from "vitest";
import { cronJobs } from "@@tests/support/cron";

// Crons are triggered by hand through cronJobs
vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

// Retries go out right away, so a country can fail 15 times within a test
vi.mock("@/shared/utils/retry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/utils/retry")>()),
  getRetryDelay: () => 0,
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
