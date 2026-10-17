import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyService } from "@/services/ProxyService";
import { cronJobs } from "@@tests/support/cron";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);
vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);
const RETRY_DELAY = 2 * 60 * 1000;

const list = (...lines: string[]) => ({ data: lines.join("\n") });

const setup = () => {
  resetSingleton(ProxyService);
  return ProxyService.getInstance();
};

// Proxy url of the agent, e.g. http://user:pass@host:port
const proxyOf = (agent: { proxy: URL }) => agent.proxy.href.replace(/\/$/, "");

describe("ProxyService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PROXY_LIST_TOKEN", "token");
    cronJobs.length = 0;
    get.mockReset();
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
});
