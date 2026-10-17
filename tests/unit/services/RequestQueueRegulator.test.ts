import os from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestQueueRegulator } from "@/services/RequestQueueRegulator";
import type { RequestQueueService } from "@/services/RequestQueueService";
import { fakeApiService } from "@@tests/support/fakes";

const ADJUST_INTERVAL = 20 * 60 * 1000;

const setup = (metrics: Record<string, number> = {}) => {
  const values: Record<string, number> = {
    "scrapers/count": 2,
    "system/mem": 50,
    "system/cpu": 80,
    "scrapers/pdp-1/cpu": 100,
    ...metrics,
  };
  const api = fakeApiService();
  api.get.mockImplementation(async (path: string) => values[path]);

  const queueService = { limit: 1000 } as RequestQueueService;
  const regulator = new RequestQueueRegulator(queueService, api.service);
  regulator.start();

  return { api, values, queueService, regulator };
};

// The first tick only loads the scrapers count
const adjustOnce = async () => {
  await vi.advanceTimersByTimeAsync(ADJUST_INTERVAL);
  await vi.advanceTimersByTimeAsync(ADJUST_INTERVAL);
};

describe("RequestQueueRegulator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("name", "pdp-1");
    // 4 cpus, 2 scrapers, 50% targeted global cpu: 100% targeted per scraper
    vi.spyOn(os, "cpus").mockReturnValue(new Array(4));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does nothing before start", async () => {
    const api = fakeApiService();
    new RequestQueueRegulator({ limit: 1000 } as RequestQueueService, api.service);

    await vi.advanceTimersByTimeAsync(2 * ADJUST_INTERVAL);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("loads the scrapers count on the first tick without adjusting", async () => {
    const { api, queueService, regulator } = setup();

    await vi.advanceTimersByTimeAsync(ADJUST_INTERVAL);

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("scrapers/count");
    expect(regulator.scrapersCount).toBe(2);
    expect(queueService.limit).toBe(1000);
  });

  it("keeps the limit when the scraper uses the targeted cpu", async () => {
    const { queueService } = setup({ "scrapers/pdp-1/cpu": 100 });
    await adjustOnce();
    expect(queueService.limit).toBe(1000);
  });

  it("raises the limit proportionally when the scraper uses less cpu", async () => {
    const { queueService } = setup({ "scrapers/pdp-1/cpu": 50 });
    await adjustOnce();
    expect(queueService.limit).toBe(1250);
  });

  it("lowers the limit proportionally when the scraper uses more cpu", async () => {
    const { queueService } = setup({ "scrapers/pdp-1/cpu": 150 });
    await adjustOnce();
    expect(queueService.limit).toBe(750);
  });

  it("does not lower the limit below 100", async () => {
    const { queueService } = setup({ "scrapers/pdp-1/cpu": 300 });
    queueService.limit = 150;
    await adjustOnce();
    expect(queueService.limit).toBe(100);
  });

  it("skips the adjustment when memory usage is over 85%", async () => {
    const { api, queueService, regulator } = setup({
      "system/mem": 86,
      "scrapers/pdp-1/cpu": 50,
      "system/cpu": 20,
    });
    await adjustOnce();

    expect(queueService.limit).toBe(1000);
    expect(regulator.targetedGlobalCpu).toBe(50);
    expect(api.get).not.toHaveBeenCalledWith("system/cpu");
  });

  describe("targeted global cpu", () => {
    it("moves halfway towards the 80% global limit", async () => {
      const { regulator } = setup({ "system/cpu": 60 });
      await adjustOnce();
      expect(regulator.targetedGlobalCpu).toBe(60);
    });

    it("goes down when the machine is over the limit", async () => {
      const { regulator } = setup({ "system/cpu": 90 });
      await adjustOnce();
      expect(regulator.targetedGlobalCpu).toBe(45);
    });

    it("ignores steps smaller than half a percent", async () => {
      const { regulator } = setup({ "system/cpu": 80.9 });
      await adjustOnce();
      expect(regulator.targetedGlobalCpu).toBe(50);
    });

    it("stays between 1 and 100", async () => {
      const low = setup({ "system/cpu": 300 });
      await adjustOnce();
      expect(low.regulator.targetedGlobalCpu).toBe(1);

      const high = setup({ "system/cpu": -200 });
      await adjustOnce();
      expect(high.regulator.targetedGlobalCpu).toBe(100);
    });
  });

  it("refreshes the scrapers count every hour", async () => {
    const { values, regulator } = setup();
    await vi.advanceTimersByTimeAsync(ADJUST_INTERVAL);
    expect(regulator.scrapersCount).toBe(2);

    values["scrapers/count"] = 4;
    await vi.advanceTimersByTimeAsync(2 * ADJUST_INTERVAL);
    expect(regulator.scrapersCount).toBe(4);
  });
});
