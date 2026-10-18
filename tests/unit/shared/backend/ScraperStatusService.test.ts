import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScraperStatusService } from "@/shared/backend/ScraperStatusService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { ScrapingClient } from "@/shared/http/ScrapingClient";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const setup = ({ isPdp = true } = {}) => {
  const args = {
    getTargetFlag: vi.fn(() => ({ isPdp, isPlp: !isPdp })),
  } as unknown as ArgsService;
  const api = fakeApiService();
  const client = {
    queueService: { speed: 3.5, pending: 12 },
  } as unknown as ScrapingClient;

  // The constructor is private, it is only called through getInstance()
  const Service = ScraperStatusService as unknown as new (
    ...deps: unknown[]
  ) => ScraperStatusService;
  new Service(args, api.service, client);

  return { api };
};

describe("ScraperStatusService", () => {
  beforeEach(() => {
    vi.stubEnv("name", "pdp-1");
    cronJobs.length = 0;
  });

  it("is a singleton", () => {
    const Service = ScraperStatusService as unknown as { instance?: unknown };
    const instance = {};
    Service.instance = instance;
    expect(ScraperStatusService.getInstance()).toBe(instance);
    resetSingleton(ScraperStatusService);
  });

  it("is sent every hour in PDP mode", () => {
    const { api } = setup({ isPdp: true });

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 50 */1 * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();

    cronJobs[0].onTick();
    expect(api.post).toHaveBeenCalledWith("scrapers/pdp-1/status", {
      speed: 3.5,
      pending: 12,
    });
  });

  it("is not sent in PLP mode", () => {
    setup({ isPdp: false });
    expect(cronJobs).toHaveLength(0);
  });
});
