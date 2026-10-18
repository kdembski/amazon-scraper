import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeteredProxyAgent } from "@/shared/http/MeteredProxyAgent";
import { ProxyService } from "@/shared/http/ProxyService";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { cronJobs } from "@@tests/support/cron";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);
vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);
const RETRY_DELAY = 2 * 60 * 1000;

const list = (...lines: string[]) => ({ data: lines.join("\n") });

const increment = vi.fn();

const setup = () => {
  resetSingleton(ProxyService);
  const Service = ProxyService as unknown as new (
    metricsService: MetricsService
  ) => ProxyService;
  const service = new Service({ increment } as unknown as MetricsService);
  (ProxyService as unknown as { instance?: unknown }).instance = service;
  return service;
};

// Proxy url of the agent, e.g. http://user:pass@host:port
const proxyOf = (agent: { proxy: URL }) => agent.proxy.href.replace(/\/$/, "");

describe("ProxyService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PROXY_LIST_TOKEN", "token");
    cronJobs.length = 0;
    get.mockReset();
    increment.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is a singleton", () => {
    const service = setup();
    expect(ProxyService.getInstance()).toBe(service);
  });

  it("reloads the proxy list every hour", async () => {
    setup();
    get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 0 */1 * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();

    await cronJobs[0].onTick();
    expect(get).toHaveBeenCalledTimes(1);
  });

  describe("loadProxies", () => {
    it("downloads the webshare list with the token", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

      await service.loadProxies();

      expect(get).toHaveBeenCalledWith(
        "https://proxy.webshare.io/api/v2/proxy/list/download/token/-/any/username/direct/-/"
      );
    });

    it("downloads the list from PROXY_LIST_URL when it is set", async () => {
      const service = setup();
      vi.stubEnv("PROXY_LIST_URL", "http://127.0.0.1:9000/proxies");
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));

      await service.loadProxies();

      expect(get).toHaveBeenCalledWith("http://127.0.0.1:9000/proxies");
    });

    it.each([
      ["\\n", "1.1.1.1:8080:u1:p1\n2.2.2.2:8081:u2:p2\n"],
      ["\\r\\n", "1.1.1.1:8080:u1:p1\r\n2.2.2.2:8081:u2:p2\r\n"],
    ])("parses lines separated by %s", async (_name, data) => {
      const service = setup();
      get.mockResolvedValue({ data });
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(proxyOf(service.getRandomAgent())).toBe("http://u1:p1@1.1.1.1:8080");

      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(proxyOf(service.getRandomAgent())).toBe("http://u2:p2@2.2.2.2:8081");
    });

    it("retries every 2 minutes until the list is downloaded", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const service = setup();
      get
        .mockRejectedValueOnce(new Error("down"))
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce(list("1.1.1.1:8080:user:pass"));
      const done = vi.fn();
      service.loadProxies().then(done);

      await vi.advanceTimersByTimeAsync(RETRY_DELAY);
      expect(get).toHaveBeenCalledTimes(2);
      expect(done).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(RETRY_DELAY);
      expect(get).toHaveBeenCalledTimes(3);
      expect(done).toHaveBeenCalled();
    });

    it("waits for a load that is already in progress", async () => {
      const service = setup();
      let respond!: (value: { data: string }) => void;
      get.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));

      const first = vi.fn();
      const second = vi.fn();
      service.loadProxies().then(first);
      service.loadProxies().then(second);

      respond(list("1.1.1.1:8080:user:pass"));
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(RETRY_DELAY);
      expect(second).toHaveBeenCalled();
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRandomAgent", () => {
    it("reuses one agent per proxy", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:u1:p1", "2.2.2.2:8081:u2:p2"));
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      const first = service.getRandomAgent();
      expect(service.getRandomAgent()).toBe(first);

      vi.spyOn(Math, "random").mockReturnValue(0.99);
      expect(service.getRandomAgent()).not.toBe(first);
    });

    it("keeps connections alive", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));
      await service.loadProxies();

      expect(service.getRandomAgent().keepAlive).toBe(true);
    });

    it("caps idle connections and closes them after 15 s", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));
      await service.loadProxies();

      const agent = service.getRandomAgent();
      expect(agent.maxFreeSockets).toBe(1);
      expect(agent.options.timeout).toBe(15 * 1000);
    });

    it("destroys agents of proxies removed from the list", async () => {
      const service = setup();
      get.mockResolvedValueOnce(list("1.1.1.1:8080:u1:p1", "2.2.2.2:8081:u2:p2"));
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      const removed = service.getRandomAgent();
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const kept = service.getRandomAgent();
      const destroyRemoved = vi.spyOn(removed, "destroy");
      const destroyKept = vi.spyOn(kept, "destroy");

      get.mockResolvedValueOnce(list("2.2.2.2:8081:u2:p2", "3.3.3.3:8082:u3:p3"));
      await service.loadProxies();

      expect(destroyRemoved).toHaveBeenCalled();
      expect(destroyKept).not.toHaveBeenCalled();

      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(service.getRandomAgent()).toBe(kept);
    });
  });

  describe("countConnections", () => {
    type Pool = Record<string, unknown[]>;

    it("counts sockets in use and idle across all agents", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:u1:p1", "2.2.2.2:8081:u2:p2"));
      await service.loadProxies();

      vi.spyOn(Math, "random").mockReturnValue(0);
      const first = service.getRandomAgent();
      vi.spyOn(Math, "random").mockReturnValue(0.99);
      const second = service.getRandomAgent();

      const sockets = first.sockets as unknown as Pool;
      sockets["www.amazon.de:443"] = [{}, {}];
      sockets["www.amazon.fr:443"] = [{}];
      (first.freeSockets as unknown as Pool)["www.amazon.de:443"] = [{}];
      (second.freeSockets as unknown as Pool)["www.amazon.it:443"] = [{}];

      expect(service.countConnections()).toBe(5);
    });

    it("returns 0 without agents", () => {
      expect(setup().countConnections()).toBe(0);
    });
  });

  describe("traffic", () => {
    type FakeSocket = { bytesRead: number; bytesWritten: number; destroyed: boolean };

    const connectSocket = async (service: ProxyService, socket: FakeSocket) => {
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));
      await service.loadProxies();
      vi.spyOn(HttpsProxyAgent.prototype, "connect").mockResolvedValue(
        socket as never
      );
      await service.getRandomAgent().connect({} as never, {} as never);
    };

    it("creates metered agents", async () => {
      const service = setup();
      get.mockResolvedValue(list("1.1.1.1:8080:user:pass"));
      await service.loadProxies();

      expect(service.getRandomAgent()).toBeInstanceOf(MeteredProxyAgent);
    });

    it("counts a tunnel for every connect", async () => {
      const service = setup();
      await connectSocket(service, { bytesRead: 0, bytesWritten: 0, destroyed: false });
      await service.getRandomAgent().connect({} as never, {} as never);

      expect(increment).toHaveBeenCalledTimes(2);
      expect(increment).toHaveBeenCalledWith("connections");
    });

    it("reports the growth since the previous call", async () => {
      const service = setup();
      const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
      await connectSocket(service, socket);

      expect(service.collectTraffic()).toEqual({ bytesIn: 100, bytesOut: 10 });

      socket.bytesRead = 250;
      socket.bytesWritten = 40;
      expect(service.collectTraffic()).toEqual({ bytesIn: 150, bytesOut: 30 });
      expect(service.collectTraffic()).toEqual({ bytesIn: 0, bytesOut: 0 });
    });

    it("counts a destroyed socket one last time and stops tracking it", async () => {
      const service = setup();
      const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
      await connectSocket(service, socket);
      service.collectTraffic();

      socket.bytesRead = 130;
      socket.destroyed = true;
      expect(service.collectTraffic()).toEqual({ bytesIn: 30, bytesOut: 0 });

      socket.bytesRead = 500;
      expect(service.collectTraffic()).toEqual({ bytesIn: 0, bytesOut: 0 });
    });
  });
});
