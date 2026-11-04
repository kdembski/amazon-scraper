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
    getDirect: vi.fn((family: 4 | 6) => ({ direct: family })),
    isDirectBlocked: vi.fn((_family: 4 | 6, _host: string) => false),
    retain: vi.fn(),
    takeLastFree: vi.fn(
      (_host: string, _accept: (url: string) => boolean): string | undefined =>
        undefined
    ),
    countConnections: vi.fn(() => 7),
    block: vi.fn(),
  };
  const list = { load: vi.fn().mockResolvedValue({ datacenter: urls, isp: ispUrls }) };
  const pingIpv6 = vi.fn<() => Promise<number | undefined>>().mockResolvedValue(undefined);

  resetSingleton(ProxyService);
  const Service = ProxyService as unknown as new (
    meter: ProxyTrafficMeter,
    pool: ProxyAgentPool,
    list: ProxyList,
    pingIpv6: () => Promise<number | undefined>
  ) => ProxyService;
  const service = new Service(
    meter as unknown as ProxyTrafficMeter,
    pool as unknown as ProxyAgentPool,
    list as unknown as ProxyList,
    pingIpv6
  );

  return { service, meter, pool, list, pingIpv6 };
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

    it("logs the number of proxies of every pool and the direct IP families", async () => {
      const { service, pingIpv6 } = setup();

      await service.loadProxies();
      pingIpv6.mockResolvedValue(12);
      await service.loadProxies();

      expect(console.log).toHaveBeenCalledWith("Proxies: datacenter 2, isp 1, direct IPv4");
      expect(console.log).toHaveBeenCalledWith("Proxies: datacenter 2, isp 1, direct IPv4+IPv6");
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

    it("returns the proxy whose idle connection to the host was freed last", async () => {
      const { service, pool } = setup();
      await service.loadProxies();
      pool.takeLastFree.mockReturnValue(urls[1]);

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[1] });
      expect(pool.takeLastFree).toHaveBeenCalledWith("www.amazon.de", expect.any(Function));
    });

    it.each([
      ["datacenter", urls[0], ispUrls[0]],
      ["isp", ispUrls[0], urls[0]],
    ])("accepts only idle proxies of the %s pool", async (proxyType, accepted, rejected) => {
      const { service, pool } = setup();
      await service.loadProxies();

      service.getAgent("www.amazon.de", proxyType);
      const accept = pool.takeLastFree.mock.calls[0][1];

      expect(accept(accepted)).toBe(true);
      expect(accept(rejected)).toBe(false);
    });

    it("picks from the pool of the proxy type", async () => {
      const { service } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de", "isp")).toEqual({ url: ispUrls[0] });
    });

    describe("direct", () => {
      it("connects over IPv4 when the server has no IPv6", async () => {
        const { service, pool } = setup();
        await service.loadProxies();

        expect(service.getAgent("www.amazon.pl", "direct")).toEqual({ direct: 4 });
        expect(service.getAgent("www.amazon.pl", "direct")).toEqual({ direct: 4 });
        expect(pool.get).not.toHaveBeenCalled();
        expect(pool.takeLastFree).not.toHaveBeenCalled();
      });

      it("connects over IPv4 and IPv6 in turn when the server has IPv6", async () => {
        const { service, pingIpv6 } = setup();
        pingIpv6.mockResolvedValue(12);
        await service.loadProxies();

        const agents = [1, 2, 3].map(() => service.getAgent("www.amazon.pl", "direct"));

        expect(agents).toEqual([{ direct: 4 }, { direct: 6 }, { direct: 4 }]);
      });

      it("skips the IP family blocked by the host", async () => {
        const { service, pool, pingIpv6 } = setup();
        pingIpv6.mockResolvedValue(12);
        await service.loadProxies();
        pool.isDirectBlocked.mockImplementation((family, host) => family === 6 && host === "www.amazon.pl");

        expect(service.getAgent("www.amazon.pl", "direct")).toEqual({ direct: 4 });
        expect(service.getAgent("www.amazon.pl", "direct")).toEqual({ direct: 4 });
      });

      it("falls back to datacenter proxies while the host blocks every IP family", async () => {
        const { service, pool } = setup();
        await service.loadProxies();
        pool.isDirectBlocked.mockReturnValue(true);

        vi.spyOn(Math, "random").mockReturnValue(0);
        expect(service.getAgent("www.amazon.pl", "direct")).toEqual({ url: urls[0] });
      });
    });

    describe("mixed", () => {
      const minute = 60 * 1000;

      it("connects directly in every other N-minute window, through datacenter proxies in between", async () => {
        const { service } = setup();
        await service.loadProxies();
        vi.spyOn(Math, "random").mockReturnValue(0);

        vi.setSystemTime(0);
        expect(service.getAgent("www.amazon.pl", "mixed2")).toEqual({ direct: 4 });
        vi.setSystemTime(2 * minute - 1);
        expect(service.getAgent("www.amazon.pl", "mixed2")).toEqual({ direct: 4 });
        vi.setSystemTime(2 * minute);
        expect(service.getAgent("www.amazon.pl", "mixed2")).toEqual({ url: urls[0] });
        vi.setSystemTime(4 * minute);
        expect(service.getAgent("www.amazon.pl", "mixed2")).toEqual({ direct: 4 });
      });

      it("connects directly for N minutes and through datacenter proxies for the next M with mixedN/M", async () => {
        const { service } = setup();
        await service.loadProxies();
        vi.spyOn(Math, "random").mockReturnValue(0);

        const agents = [0, 1, 2, 3, 4].map((m) => {
          vi.setSystemTime(m * minute);
          return service.getAgent("www.amazon.pl", "mixed1/2");
        });

        expect(agents).toEqual([
          { direct: 4 },
          { url: urls[0] },
          { url: urls[0] },
          { direct: 4 },
          { url: urls[0] },
        ]);
      });

      it("accepts only idle datacenter proxies between the direct windows", async () => {
        const { service, pool } = setup();
        await service.loadProxies();
        vi.setSystemTime(minute);

        service.getAgent("www.amazon.pl", "mixed1");
        const accept = pool.takeLastFree.mock.calls[0][1];

        expect(accept(urls[0])).toBe(true);
        expect(accept(ispUrls[0])).toBe(false);
      });

      it("falls back to datacenter proxies while the host blocks direct connections", async () => {
        const { service, pool } = setup();
        await service.loadProxies();
        pool.isDirectBlocked.mockReturnValue(true);
        vi.setSystemTime(0);

        vi.spyOn(Math, "random").mockReturnValue(0);
        expect(service.getAgent("www.amazon.pl", "mixed1")).toEqual({ url: urls[0] });
      });
    });

    it.each([
      ["an unknown", { datacenter: urls }, "residential"],
      ["a mixed without a window", { datacenter: urls }, "mixed"],
      ["a mixed with a zero window", { datacenter: urls }, "mixed0"],
      ["a mixed with a zero direct window", { datacenter: urls }, "mixed0/2"],
      ["a malformed mixed", { datacenter: urls }, "mixed1/"],
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
