import axios from "axios";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import type { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import type { ProxyService } from "@/shared/http/proxy/ProxyService";
import type { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";

vi.mock("axios", () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(axios.get);

// The constructor is private, it is only called through getInstance()
const Client = ScrapingClient as unknown as new (
  ...deps: unknown[]
) => ScrapingClient;

const setup = () => {
  const agent = { name: "agent" };
  const proxy = {
    getAgent: vi.fn(() => agent),
  } as unknown as ProxyService;
  const requests: Promise<unknown>[] = [];
  const queue = {
    start: vi.fn(),
    request: vi.fn((callback: () => Promise<unknown>) => {
      requests.push(callback());
    }),
  };
  const service = new Client(
    {} as ScraperConfigService,
    proxy,
    queue as unknown as TokenBucketQueue
  );

  return { service, agent, proxy, queue, requests };
};

describe("ScrapingClient", () => {
  beforeEach(() => {
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
    const config = {
      get: vi.fn(() => ({ concurrency: 10, rps: 0, batchSize: 50 })),
    };
    const proxy = { countConnections: vi.fn(() => 7) };

    new Client(config, proxy);
    await vi.advanceTimersByTimeAsync(1000);

    expect(log.mock.calls[0][0]).toContain("connections: 7");
    vi.useRealTimers();
  });

  describe("get", () => {
    it("requests the url through the queue with a proxy agent of the proxy type", async () => {
      const { service, agent, proxy, queue, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });

      service.get(
        "https://www.amazon.de/dp/B0TESTASIN",
        "https://www.amazon.de/s?k=B0TESTASIN",
        undefined,
        {},
        "isp"
      );
      await Promise.all(requests);

      expect(queue.request).toHaveBeenCalledTimes(1);
      expect(proxy.getAgent).toHaveBeenCalledWith("www.amazon.de", "isp");
      expect(get).toHaveBeenCalledWith("https://www.amazon.de/dp/B0TESTASIN", {
        httpsAgent: agent,
        signal: expect.any(AbortSignal),
        headers: {
          "User-Agent": expect.stringMatching(/\S+/),
          Referer: "https://www.amazon.de/s?k=B0TESTASIN",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });
    });

    it("sends only desktop Chrome User-Agents", async () => {
      const { service, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });

      for (let i = 0; i < 50; i++) service.get("https://www.amazon.pl/s?i=toys", "https://www.amazon.pl");
      await Promise.all(requests);

      const userAgents = get.mock.calls.map(
        ([, config]) => config!.headers!["User-Agent"] as string
      );
      expect(userAgents).toHaveLength(50);
      userAgents.forEach((userAgent) => {
        expect(userAgent).not.toMatch(/Mobile|Android|iPhone|iPad|Edg|Firefox/);
        expect(userAgent).toMatch(/Windows NT 10\.0.* Chrome\/\d+\.0\.0\.0 Safari/);
      });
    });

    it("passes the response data to onSuccess", async () => {
      const { service, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });
      const callback = {
        onSuccess: vi.fn(),
        onError: vi.fn(),
      };

      service.get("https://www.amazon.de/dp/B0TESTASIN", "https://www.amazon.de", callback);
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

      service.get("https://www.amazon.de/dp/B0TESTASIN", "https://www.amazon.de", callback);
      await expect(Promise.all(requests)).resolves.toBeDefined();

      expect(callback.onError).toHaveBeenCalledWith(error);
      expect(callback.onSuccess).not.toHaveBeenCalled();
    });

    it("passes an error thrown before the request to onError and still finishes the queued task", async () => {
      const { service, proxy, requests } = setup();
      const error = new Error("no proxy");
      vi.mocked(proxy.getAgent).mockImplementation(() => {
        throw error;
      });
      const callback = { onSuccess: vi.fn(), onError: vi.fn() };

      service.get("https://www.amazon.de/dp/B0TESTASIN", "https://www.amazon.de", callback);
      await expect(Promise.all(requests)).resolves.toBeDefined();

      expect(callback.onError).toHaveBeenCalledWith(error);
      expect(get).not.toHaveBeenCalled();
    });

    describe("metrics", () => {
      const setupMetrics = () => {
        const metrics = { increment: vi.fn() };
        const queue = {
          start: vi.fn(),
          request: vi.fn(),
        };
        const requests: Promise<unknown>[] = [];
        queue.request.mockImplementation((cb: () => Promise<unknown>) => {
          requests.push(cb());
        });
        const service = new Client(
          {} as ScraperConfigService,
          { getAgent: vi.fn() },
          queue,
          metrics
        );
        return { service, metrics, requests };
      };
      const url = "https://www.amazon.de/dp/X";

      it("counts a successful request with the country label", async () => {
        const { service, metrics, requests } = setupMetrics();
        get.mockResolvedValue({ data: "<html>" });

        service.get(url, undefined, undefined, { country: "de" });
        await Promise.all(requests);

        expect(metrics.increment).toHaveBeenCalledWith("requests", {
          country: "de",
          outcome: "ok",
        });
      });

      it("counts the outcome without labels", async () => {
        const { service, metrics, requests } = setupMetrics();
        get.mockResolvedValue({ data: "" });

        service.get(url);
        await Promise.all(requests);

        expect(metrics.increment).toHaveBeenCalledWith("requests", {
          outcome: "ok",
        });
      });

      it.each([
        [{ response: { status: 503 } }, "http_503"],
        [{ code: "ERR_CANCELED" }, "timeout"],
        [new Error("ECONNRESET"), "network"],
      ])("maps error %j to %s", async (error, outcome) => {
        const { service, metrics, requests } = setupMetrics();
        get.mockRejectedValue(error);

        service.get(url, undefined, undefined, { country: "de" });
        await Promise.all(requests);

        expect(metrics.increment).toHaveBeenCalledWith("requests", {
          country: "de",
          outcome,
        });
      });

      it("records request_ms with the labels", async () => {
        const { service, metrics, requests } = setupMetrics();
        get.mockResolvedValue({ data: "" });

        service.get(url, undefined, undefined, { country: "de" });
        await Promise.all(requests);

        expect(metrics.increment).toHaveBeenCalledWith(
          "request_ms",
          { country: "de" },
          expect.any(Number)
        );
        const value = metrics.increment.mock.calls.find(
          ([name]) => name === "request_ms"
        )![2];
        expect(value).toBeGreaterThanOrEqual(0);
      });

      it("counts once as ok even when onSuccess throws", async () => {
        const { service, metrics, requests } = setupMetrics();
        get.mockResolvedValue({ data: "" });
        const onError = vi.fn();

        service.get(url, undefined, {
          onSuccess: () => {
            throw new Error("boom");
          },
          onError,
        });
        await Promise.all(requests);

        const counted = metrics.increment.mock.calls.filter(
          ([name]) => name === "requests"
        );
        expect(counted).toEqual([["requests", { outcome: "ok" }]]);
      });
    });

    describe("with stopAt", () => {
      const url = "https://www.amazon.de/dp/X";
      const stopAt = ["<b>", "&&&"];

      const setupStream = (chunks: (string | Buffer)[], error?: Error) => {
        const metrics = { increment: vi.fn() };
        const requests: Promise<unknown>[] = [];
        const queue = {
          start: vi.fn(),
          request: vi.fn((cb: () => Promise<unknown>) => {
            requests.push(cb());
          }),
        };
        const service = new Client({} as ScraperConfigService, { getAgent: vi.fn() }, queue, metrics);
        const stream = Readable.from(
          (async function* () {
            for (const chunk of chunks) yield Buffer.from(chunk);
            if (error) throw error;
          })()
        );
        get.mockResolvedValue({ data: stream });
        const callback = { onSuccess: vi.fn(), onError: vi.fn() };
        const run = async (markers: string[] = stopAt) => {
          service.get(url, undefined, callback, {}, undefined, markers);
          await Promise.all(requests);
        };

        return { run, callback, metrics, stream };
      };

      it("reads the response as a stream and cuts it after the last marker", async () => {
        const { run, callback, metrics, stream } = setupStream(["<a>", "<b>x&&&y", "rest"]);

        await run();

        expect(get.mock.calls[0][1]).toMatchObject({ responseType: "stream" });
        expect(callback.onSuccess).toHaveBeenCalledTimes(1);
        expect(callback.onSuccess).toHaveBeenCalledWith("<a><b>x&&&y");
        expect(stream.destroyed).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "ok" });
      });

      it("cuts at markers split across chunks", async () => {
        const { run, callback } = setupStream(["<a><", "b>x&&", "&y", "rest"]);

        await run();

        expect(callback.onSuccess).toHaveBeenCalledWith("<a><b>x&&&y");
      });

      it("ignores a later marker seen before the earlier one", async () => {
        const { run, callback } = setupStream(["&&&", "<b>", "x&&&", "rest"]);

        await run();

        expect(callback.onSuccess).toHaveBeenCalledWith("&&&<b>x&&&");
      });

      it("passes the whole response when the markers never arrive", async () => {
        const { run, callback } = setupStream(["<a>", "<b>"]);

        await run();

        expect(callback.onSuccess).toHaveBeenCalledWith("<a><b>");
      });

      it("decodes a character split across chunks", async () => {
        const euro = Buffer.from("€");
        const { run, callback } = setupStream([euro.subarray(0, 1), euro.subarray(1)]);

        await run(["x"]);

        expect(callback.onSuccess).toHaveBeenCalledWith("€");
      });

      it("reports a stream error once", async () => {
        const { run, callback, metrics } = setupStream(["<a>"], new Error("reset"));

        await run();

        expect(callback.onError).toHaveBeenCalledTimes(1);
        expect(callback.onSuccess).not.toHaveBeenCalled();
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "network" });
      });

      it("drains the body of an error response so the connection is freed", async () => {
        const { run, callback } = setupStream([]);
        const body = Readable.from([Buffer.from("not found")]);
        get.mockReset();
        get.mockRejectedValue({ response: { status: 404, data: body } });

        await run();
        await new Promise((resolve) => body.once("end", resolve));

        expect(body.readableEnded).toBe(true);
        expect(callback.onError).toHaveBeenCalledTimes(1);
      });

      it("counts a stream cancelled by the timeout as timeout", async () => {
        const error = Object.assign(new Error("canceled"), { code: "ERR_CANCELED" });
        const { run, metrics } = setupStream(["<a>"], error);

        await run();

        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "timeout" });
      });
    });

    it("skips a request cancelled while queued", async () => {
      const { service, proxy, requests } = setup();
      const callback = { onSuccess: vi.fn(), onError: vi.fn(), isCancelled: () => true };

      service.get("https://www.amazon.de/dp/B0TESTASIN", "https://www.amazon.de", callback);
      await Promise.all(requests);

      expect(get).not.toHaveBeenCalled();
      expect(proxy.getAgent).not.toHaveBeenCalled();
      expect(callback.onSuccess).not.toHaveBeenCalled();
      expect(callback.onError).not.toHaveBeenCalled();
    });

    it("works without callbacks", async () => {
      const { service, requests } = setup();
      get.mockRejectedValue(new Error("down"));

      service.get("https://www.amazon.de/dp/B0TESTASIN");
      await expect(Promise.all(requests)).resolves.toBeDefined();
    });
  });
});
