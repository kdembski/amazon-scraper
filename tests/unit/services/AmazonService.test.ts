import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonService } from "@/services/AmazonService";
import type { ArgsService } from "@/services/ArgsService";
import type { ProxyService } from "@/services/ProxyService";
import type { RequestQueueService } from "@/services/RequestQueueService";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);
vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);

const setup = ({ isPdp = true } = {}) => {
  const args = {
    getTargetFlag: vi.fn(() => ({ isPdp, isPlp: !isPdp })),
  } as unknown as ArgsService;
  const api = fakeApiService();
  const agent = { name: "agent" };
  const proxy = {
    getRandomAgent: vi.fn(() => agent),
  } as unknown as ProxyService;
  const requests: Promise<unknown>[] = [];
  const queue = {
    start: vi.fn(),
    request: vi.fn((callback: () => Promise<unknown>) => {
      requests.push(callback());
    }),
    speed: 3.5,
    pending: 12,
  };

  // The constructor is private, it is only called through getInstance()
  const Service = AmazonService as unknown as new (
    ...deps: unknown[]
  ) => AmazonService;
  const service = new Service(
    args,
    api.service,
    proxy,
    queue as unknown as RequestQueueService
  );

  return { service, api, agent, queue, requests };
};

describe("AmazonService", () => {
  beforeEach(() => {
    vi.stubEnv("name", "pdp-1");
    cronJobs.length = 0;
    get.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the request queue", () => {
    const { queue } = setup();
    expect(queue.start).toHaveBeenCalled();
  });

  it("logs open proxy connections with the queue state", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const args = {
      getTargetFlag: vi.fn(() => ({ isPdp: true, isPlp: false })),
      getLimitFlag: vi.fn(() => 10),
      getRateFlag: vi.fn(() => 0),
    };
    const proxy = { countConnections: vi.fn(() => 7) };

    const Service = AmazonService as unknown as new (
      ...deps: unknown[]
    ) => AmazonService;
    new Service(args, fakeApiService().service, proxy);
    await vi.advanceTimersByTimeAsync(1000);

    expect(log.mock.calls[0][0]).toContain("connections: 7");
    vi.useRealTimers();
  });

  describe("status", () => {
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

  describe("get", () => {
    it("requests the url through the queue with a proxy agent", async () => {
      const { service, agent, queue, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });

      service.get("de/dp/B0TESTASIN", "de/s?k=B0TESTASIN");
      await Promise.all(requests);

      expect(queue.request).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith("https://www.amazon.de/dp/B0TESTASIN", {
        httpsAgent: agent,
        signal: expect.any(AbortSignal),
        headers: {
          "User-Agent": expect.stringMatching(/\S+/),
          Referer: "https://www.amazon.de/s?k=B0TESTASIN",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      });
    });

    it("passes the response data to onSuccess", async () => {
      const { service, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });
      const callback = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
      };

      service.get("de/dp/B0TESTASIN", "de", callback);
      await Promise.all(requests);

      expect(callback.onSuccess).toHaveBeenCalledWith("<html>");
      expect(callback.onError).not.toHaveBeenCalled();
    });

    it("passes the error to onError and still finishes the queued task", async () => {
      const { service, requests } = setup();
      const error = { status: 404 };
      get.mockRejectedValue(error);
      const callback = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
      };

      service.get("de/dp/B0TESTASIN", "de", callback);
      await expect(Promise.all(requests)).resolves.toBeDefined();

      expect(callback.onError).toHaveBeenCalledWith(error);
      expect(callback.onSuccess).not.toHaveBeenCalled();
    });

    it("works without callbacks", async () => {
      const { service, requests } = setup();
      get.mockRejectedValue(new Error("down"));

      service.get("de/dp/B0TESTASIN");
      await expect(Promise.all(requests)).resolves.toBeDefined();
    });
  });
});
