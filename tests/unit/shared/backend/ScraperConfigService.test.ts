import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import type { RequestQueueService } from "@/shared/http/RequestQueueService";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const config = { concurrency: 150, rps: 150, batchSize: 5000 };

const setup = () => {
  const api = fakeApiService();
  const queue = { concurrency: 10, rps: 0, setRps: vi.fn((rps: number) => (queue.rps = rps)) };
  // The constructor is private, it is only called through getInstance()
  const Service = ScraperConfigService as unknown as new (
    ...deps: unknown[]
  ) => ScraperConfigService;
  const service = new Service(
    api.service,
    () => queue as unknown as RequestQueueService
  );
  return { service, get: api.get, queue };
};

describe("ScraperConfigService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("name", "amazon-pdp-1");
    cronJobs.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns defaults before load", () => {
    const { service } = setup();

    expect(service.get()).toEqual({ concurrency: 10, rps: 0, batchSize: 50 });
  });

  it("loads the config of this scraper and applies it to the queue", async () => {
    const { service, get, queue } = setup();
    get.mockResolvedValue(config);

    await service.load();

    expect(get).toHaveBeenCalledWith("scrapers/amazon-pdp-1/config");
    expect(service.get()).toEqual(config);
    expect(queue.concurrency).toBe(150);
    expect(queue.setRps).toHaveBeenCalledWith(150);
  });

  it("retries load until the backend answers", async () => {
    const { service, get } = setup();
    get
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(config);

    const loaded = service.load();
    await vi.runAllTimersAsync();
    await loaded;

    expect(get).toHaveBeenCalledTimes(3);
    expect(service.get()).toEqual(config);
  });

  it("keeps the last config when refresh fails", async () => {
    const { service, get, queue } = setup();
    get.mockResolvedValueOnce(config).mockRejectedValueOnce(new Error("down"));
    await service.load();

    await service.refresh();

    expect(service.get()).toEqual(config);
    expect(queue.concurrency).toBe(150);
    expect(console.error).toHaveBeenCalled();
  });

  it("applies only changed fields", async () => {
    const { service, get, queue } = setup();
    get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ ...config, batchSize: 1000 });
    await service.load();

    await service.refresh();

    expect(service.get().batchSize).toBe(1000);
    expect(queue.setRps).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("config: batchSize 5000 -> 1000");
  });

  it("rejects invalid fields and keeps the rest", async () => {
    const { service, get, queue } = setup();
    get
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce({ concurrency: 0, rps: -1, batchSize: 200 });
    await service.load();

    await service.refresh();

    expect(service.get()).toEqual({ concurrency: 150, rps: 150, batchSize: 200 });
    expect(queue.concurrency).toBe(150);
    expect(console.warn).toHaveBeenCalledWith("config: invalid concurrency 0");
    expect(console.warn).toHaveBeenCalledWith("config: invalid rps -1");
  });

  it("refreshes every minute", async () => {
    const { service, get } = setup();
    get.mockResolvedValue(config);

    service.start();

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 * * * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();
    await cronJobs[0].onTick();
    expect(get).toHaveBeenCalledWith("scrapers/amazon-pdp-1/config");
  });
});
