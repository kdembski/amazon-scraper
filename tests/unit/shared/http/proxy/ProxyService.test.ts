import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import type { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import type { ProxyList } from "@/shared/http/proxy/ProxyList";
import type { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { cronJobs } from "@@tests/support/cron";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const urls = ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"];
const ispUrls = ["http://u3:p3@3.3.3.3:8082"];

const setup = () => {
  const meter = { collect: vi.fn(() => ({ bytesIn: 3, bytesOut: 1 })) };
  const pool = {
    get: vi.fn((url: string) => ({ url })),
    retain: vi.fn(),
    hasFreeSocket: vi.fn((_url: string, _host: string) => false),
    countConnections: vi.fn(() => 7),
  };
  const list = { load: vi.fn().mockResolvedValue({ datacenter: urls, isp: ispUrls }) };

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
    vi.spyOn(console, "log").mockImplementation(() => {});
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
    it("keeps only the agents of the proxies of all loaded pools", async () => {
      const { service, pool } = setup();

      await service.loadProxies();

      expect(pool.retain).toHaveBeenCalledWith([...urls, ...ispUrls]);
    });

    it("logs the number of proxies of every pool", async () => {
      const { service } = setup();

      await service.loadProxies();

      expect(console.log).toHaveBeenCalledWith("Proxies: datacenter 2, isp 1");
    });

    it("lets a second caller share the load in progress", async () => {
      const { service, list } = setup();
      let respond!: (pools: Record<string, string[]>) => void;
      list.load.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

      const first = vi.fn();
      const second = vi.fn();
      service.loadProxies().then(first);
      service.loadProxies().then(second);

      respond({ datacenter: urls });
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toHaveBeenCalled();
      expect(second).toHaveBeenCalled();
      expect(list.load).toHaveBeenCalledTimes(1);
    });

    it("loads the list again once the previous load has finished", async () => {
      const { service, list } = setup();

      await service.loadProxies();
      await service.loadProxies();

      expect(list.load).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAgent", () => {
    it("returns the pool agent of a random loaded proxy without idle connections", async () => {
      const { service, pool } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[0] });

      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[1] });
      expect(pool.get).toHaveBeenCalledTimes(2);
    });

    it("returns the first random proxy with an idle connection to the host", async () => {
      const { service, pool } = setup();
      await service.loadProxies();
      pool.hasFreeSocket.mockImplementation(
        (url: string, host: string) => url === urls[1] && host === "www.amazon.de"
      );

      vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[1] });
      expect(pool.hasFreeSocket).toHaveBeenCalledTimes(2);
    });

    it("checks at most 20 random proxies for an idle connection", async () => {
      const { service, pool } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.fr")).toEqual({ url: urls[0] });
      expect(pool.hasFreeSocket).toHaveBeenCalledTimes(20);
    });

    it("picks from the pool of the proxy type", async () => {
      const { service } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de", "isp")).toEqual({ url: ispUrls[0] });
    });

    it.each([
      ["an unknown", { datacenter: urls }, "residential"],
      ["an empty", { datacenter: urls, isp: [] }, "isp"],
    ])("falls back to the datacenter pool for %s pool", async (_name, pools, proxyType) => {
      const { service, list } = setup();
      list.load.mockResolvedValueOnce(pools);
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de", proxyType)).toEqual({ url: urls[0] });
    });
  });

  it("counts connections of the pool", () => {
    expect(setup().service.countConnections()).toBe(7);
  });

  it("collects traffic from the meter", () => {
    expect(setup().service.collectTraffic()).toEqual({ bytesIn: 3, bytesOut: 1 });
  });
});
