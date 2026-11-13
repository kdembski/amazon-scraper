import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
import type { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import type { ProxyList } from "@/shared/http/proxy/ProxyList";
import type { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { cronJobs } from "@@tests/support/cron";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const urls = ["http://u1:p1@1.1.1.1:8080", "http://u2:p2@2.2.2.2:8081"];
const otherUrls = ["http://u3:p3@3.3.3.3:8082"];
const unknownUrl = "http://u9:p9@9.9.9.9:8089";
const plans = [
  { urls, weight: 3 },
  { urls: otherUrls, weight: 1 },
];

const setup = () => {
  const meter = {
    collect: vi.fn(() => [{ labels: { outcome: "proxy" }, bytesIn: 3, bytesOut: 1 }]),
    setCountry: vi.fn(),
  };
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
    getRoute: vi.fn(),
  };
  const list = { load: vi.fn().mockResolvedValue(plans) };
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
    it("keeps only the agents of the proxies of all loaded plans", async () => {
      const { service, pool } = setup();

      await service.loadProxies();

      expect(pool.retain).toHaveBeenCalledWith([...urls, ...otherUrls]);
    });

    it("logs the number of proxies, the share of every plan and the direct IP families", async () => {
      const { service, pingIpv6 } = setup();

      await service.loadProxies();
      pingIpv6.mockResolvedValue(12);
      await service.loadProxies();

      expect(console.log).toHaveBeenCalledWith("Proxies: datacenter 3 (2 75%, 1 25%), direct IPv4");
      expect(console.log).toHaveBeenCalledWith("Proxies: datacenter 3 (2 75%, 1 25%), direct IPv4+IPv6");
    });

    it("lets a second caller share the load in progress", async () => {
      const { service, list } = setup();
      let respond!: (loaded: typeof plans) => void;
      list.load.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

      const first = vi.fn();
      const second = vi.fn();
      service.loadProxies().then(first);
      service.loadProxies().then(second);

      respond(plans);
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
    it("returns the pool agent of a random proxy of a plan picked by weight without idle connections", async () => {
      const { service, pool } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[0] });

      vi.spyOn(Math, "random").mockReturnValue(0.74);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[1] });

      vi.spyOn(Math, "random").mockReturnValue(0.75);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: otherUrls[0] });
      expect(pool.get).toHaveBeenCalledTimes(3);
    });

    it("never picks a plan with no bandwidth left", async () => {
      const { service, list } = setup();
      list.load.mockResolvedValueOnce([{ urls, weight: 0 }, { urls: otherUrls, weight: 1 }]);
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: otherUrls[0] });
    });

    it("picks any plan when none has bandwidth left", async () => {
      const { service, list } = setup();
      list.load.mockResolvedValueOnce([{ urls, weight: 0 }, { urls: otherUrls, weight: 0 }]);
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: otherUrls[0] });
    });

    it("skips a plan without proxies", async () => {
      const { service, list, pool } = setup();
      list.load.mockResolvedValueOnce([{ urls: [], weight: 9 }, { urls, weight: 1 }]);
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[0] });
      expect(pool.retain).toHaveBeenCalledWith(urls);
    });

    it("returns the proxy whose idle connection to the host was freed last", async () => {
      const { service, pool } = setup();
      await service.loadProxies();
      pool.takeLastFree.mockReturnValue(urls[1]);

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de")).toEqual({ url: urls[1] });
      expect(pool.takeLastFree).toHaveBeenCalledWith("www.amazon.de", expect.any(Function));
    });

    it("accepts only idle proxies of the loaded plans", async () => {
      const { service, pool } = setup();
      await service.loadProxies();

      service.getAgent("www.amazon.de");
      const accept = pool.takeLastFree.mock.calls[0][1];

      expect(accept(urls[0])).toBe(true);
      expect(accept(otherUrls[0])).toBe(true);
      expect(accept(unknownUrl)).toBe(false);
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
        expect(accept(unknownUrl)).toBe(false);
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
      ["an unknown", "isp"],
      ["a mixed without a window", "mixed"],
      ["a mixed with a zero window", "mixed0"],
      ["a mixed with a zero direct window", "mixed0/2"],
      ["a malformed mixed", "mixed1/"],
    ])("uses datacenter proxies for %s proxy type", async (_name, proxyType) => {
      const { service } = setup();
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getAgent("www.amazon.de", proxyType)).toEqual({ url: urls[0] });
    });
  });

  it("counts connections of the pool", () => {
    expect(setup().service.countConnections()).toBe(7);
  });

  it("collects traffic from the meter", () => {
    expect(setup().service.collectTraffic()).toEqual([
      { labels: { outcome: "proxy" }, bytesIn: 3, bytesOut: 1 },
    ]);
  });

  it("names the route of an agent by the pool", () => {
    const { service, pool } = setup();
    pool.getRoute.mockReturnValue("direct6");
    const agent = { direct: 6 };

    expect(service.getRoute(agent as never)).toBe("direct6");
    expect(pool.getRoute).toHaveBeenCalledWith(agent);
  });

  it("passes the country of a host to the meter", () => {
    const { service, meter } = setup();

    service.setCountry("www.amazon.de", "de");

    expect(meter.setCountry).toHaveBeenCalledWith("www.amazon.de", "de");
  });

  it("tracks new connections of the pool in the meter with host and route", () => {
    resetSingleton(ProxyService);
    const service = ProxyService.getInstance() as unknown as {
      meter: ProxyTrafficMeter;
      pool: { onConnect: (...args: unknown[]) => void };
    };
    const track = vi.spyOn(service.meter, "track").mockImplementation(() => {});
    const socket = {};

    service.pool.onConnect(socket, "www.amazon.de", "direct4");

    expect(track).toHaveBeenCalledWith(socket, "www.amazon.de", "direct4");
    resetSingleton(ProxyService);
  });

  it("uses sessions of Http2Endpoint with env HTTP2", () => {
    vi.stubEnv("HTTP2", "1");
    resetSingleton(ProxyService);
    const service = ProxyService.getInstance();
    vi.unstubAllEnvs();

    expect(service.getAgent("www.amazon.de", "direct")).toBeInstanceOf(Http2Endpoint);
    resetSingleton(ProxyService);
  });

  it("uses http agents without env HTTP2", () => {
    vi.stubEnv("HTTP2", "");
    resetSingleton(ProxyService);
    const service = ProxyService.getInstance();
    vi.unstubAllEnvs();

    expect(service.getAgent("www.amazon.de", "direct")).not.toBeInstanceOf(Http2Endpoint);
    resetSingleton(ProxyService);
  });

  it("passes a block of an agent for a host to the pool", () => {
    const { service, pool } = setup();
    const agent = { direct: 4 };

    service.block(agent as never, "www.amazon.de");

    expect(pool.block).toHaveBeenCalledWith(agent, "www.amazon.de");
  });
});
