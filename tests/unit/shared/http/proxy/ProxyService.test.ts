import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import type { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import type { ProxyList } from "@/shared/http/proxy/ProxyList";
import type { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { cronJobs } from "@@tests/support/cron";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const WAIT_DELAY = 2 * 60 * 1000;
const urls = ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"];

const setup = () => {
  const meter = { collect: vi.fn(() => ({ bytesIn: 3, bytesOut: 1 })) };
  const pool = {
    get: vi.fn((url: string) => ({ url })),
    retain: vi.fn(),
    countConnections: vi.fn(() => 7),
  };
  const list = { load: vi.fn().mockResolvedValue(urls) };

  resetSingleton(ProxyService);
  const Service = ProxyService as unknown as new (
    meter: ProxyTrafficMeter,
    pool: ProxyAgentPool,
    list: ProxyList
  ) => ProxyService;
  const service = new Service(
    meter as unknown as ProxyTrafficMeter,
    pool as unknown as ProxyAgentPool,
    list as unknown as ProxyList
  );

  return { service, meter, pool, list };
};

describe("ProxyService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cronJobs.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is a singleton", () => {
    resetSingleton(ProxyService);
    const service = ProxyService.getInstance();
    expect(ProxyService.getInstance()).toBe(service);
    resetSingleton(ProxyService);
  });

  it("reloads the proxy list every hour", async () => {
    const { list } = setup();

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 0 */1 * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();

    await cronJobs[0].onTick();
    expect(list.load).toHaveBeenCalledTimes(1);
  });

  describe("loadProxies", () => {
    it("keeps only the agents of the loaded proxies", async () => {
      const { service, pool } = setup();

      await service.loadProxies();

      expect(pool.retain).toHaveBeenCalledWith(urls);
    });

    it("makes a second caller wait while a load is in progress", async () => {
      const { service, list } = setup();
      let respond!: (urls: string[]) => void;
      list.load.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

      const first = vi.fn();
      const second = vi.fn();
      service.loadProxies().then(first);
      service.loadProxies().then(second);

      respond(urls);
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(WAIT_DELAY);
      expect(second).toHaveBeenCalled();
      expect(list.load).toHaveBeenCalledTimes(1);
    });
  });

  it("returns the pool agent of a random loaded proxy", async () => {
    const { service, pool } = setup();
    await service.loadProxies();

    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(service.getRandomAgent()).toEqual({ url: urls[0] });

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(service.getRandomAgent()).toEqual({ url: urls[1] });
    expect(pool.get).toHaveBeenCalledTimes(2);
  });

  it("counts connections of the pool", () => {
    expect(setup().service.countConnections()).toBe(7);
  });

  it("collects traffic from the meter", () => {
    expect(setup().service.collectTraffic()).toEqual({ bytesIn: 3, bytesOut: 1 });
  });
});
