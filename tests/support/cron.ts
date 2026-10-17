import { vi } from "vitest";

type FakeCronJob = {
  cronTime: string;
  onTick: () => unknown;
  start: ReturnType<typeof vi.fn>;
};

// Every CronJob created while the module is mocked, in creation order
export const cronJobs: FakeCronJob[] = [];

// Usage: vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);
export const cronModule = {
  CronJob: class {
    start = vi.fn();

    constructor(
      public cronTime: string,
      public onTick: () => unknown
    ) {
      cronJobs.push(this);
    }
  },
};
