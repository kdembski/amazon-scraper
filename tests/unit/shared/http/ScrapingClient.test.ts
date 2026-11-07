import axios from "axios";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StopAt } from "@/shared/http/http.types";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
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
    block: vi.fn(),
    getRoute: vi.fn(() => "proxy"),
    setCountry: vi.fn(),
  } as unknown as ProxyService;
  const requests: Promise<unknown>[] = [];
  const queue = {
    request: vi.fn((callback: () => Promise<unknown>) => {
      requests.push(callback());
    }),
  };
  const service = new Client(
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

  describe("get", () => {
    it("requests the url through the queue with a proxy agent of the proxy type", async () => {
      const { service, agent, proxy, queue } = setup();
      get.mockResolvedValue({ data: "<html>" });

      await service.get("https://www.amazon.de/dp/B0TESTASIN", {
        referer: "https://www.amazon.de/s?k=B0TESTASIN",
        proxyType: "isp",
      });

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
      const { service } = setup();
      get.mockResolvedValue({ data: "<html>" });

      for (let i = 0; i < 50; i++) await service.get("https://www.amazon.pl/s?i=toys");

      const userAgents = get.mock.calls.map(
        ([, config]) => config!.headers!["User-Agent"] as string
      );
      expect(userAgents).toHaveLength(50);
      userAgents.forEach((userAgent) => {
        expect(userAgent).not.toMatch(/Mobile|Android|iPhone|iPad|Edg|Firefox/);
        expect(userAgent).toMatch(/Windows NT 10\.0.* Chrome\/\d+\.0\.0\.0 Safari/);
      });
    });

    it("resolves to the response data", async () => {
      const { service } = setup();
      get.mockResolvedValue({ data: "<html>" });

      await expect(service.get("https://www.amazon.de/dp/B0TESTASIN")).resolves.toBe("<html>");
    });

    it.each([403, 429])("blocks the agent for the host on a %s before rejecting", async (status) => {
      const { service, agent, proxy } = setup();
      get.mockRejectedValue({ response: { status } });

      const onRejected = vi.fn(() => {
        expect(proxy.block).toHaveBeenCalledWith(agent, "www.amazon.de");
      });

      await service.get("https://www.amazon.de/dp/B0TESTASIN").catch(onRejected);

      expect(onRejected).toHaveBeenCalled();
    });

    it.each([404, 503])("does not block the agent on a %s", async (status) => {
      const { service, proxy } = setup();
      get.mockRejectedValue({ response: { status } });

      await expect(service.get("https://www.amazon.de/dp/B0TESTASIN")).rejects.toBeDefined();

      expect(proxy.block).not.toHaveBeenCalled();
    });

    it("rejects with the error and still finishes the queued task", async () => {
      const { service, requests } = setup();
      const error = { status: 404 };
      get.mockRejectedValue(error);

      await expect(service.get("https://www.amazon.de/dp/B0TESTASIN")).rejects.toBe(error);
      await expect(Promise.all(requests)).resolves.toBeDefined();
    });

    it("rejects with an error thrown before the request and still finishes the queued task", async () => {
      const { service, proxy, requests } = setup();
      const error = new Error("no proxy");
      vi.mocked(proxy.getAgent).mockImplementation(() => {
        throw error;
      });

      await expect(service.get("https://www.amazon.de/dp/B0TESTASIN")).rejects.toBe(error);
      await expect(Promise.all(requests)).resolves.toBeDefined();

      expect(get).not.toHaveBeenCalled();
    });

    describe("metrics", () => {
      const setupMetrics = () => {
        const metrics = { increment: vi.fn() };
        const queue = {
          request: vi.fn(),
        };
        const requests: Promise<unknown>[] = [];
        queue.request.mockImplementation((cb: () => Promise<unknown>) => {
          requests.push(cb());
        });
        const proxy = {
          getAgent: vi.fn(),
          block: vi.fn(),
          getRoute: vi.fn(() => "direct6"),
          setCountry: vi.fn(),
        };
        const service = new Client(
          proxy,
          queue,
          metrics
        );
        return { service, metrics, proxy, requests };
      };
      const url = "https://www.amazon.de/dp/X";
      const labels = { labels: { country: "de" } };

      it("counts a successful request with the country label", async () => {
        const { service, metrics } = setupMetrics();
        get.mockResolvedValue({ data: "<html>" });

        await service.get(url, labels);

        expect(metrics.increment).toHaveBeenCalledWith("requests", {
          country: "de",
          outcome: "ok",
        });
      });

      it("counts the request also under the route of its agent", async () => {
        const { service, metrics } = setupMetrics();
        get.mockRejectedValue({ response: { status: 503 } });

        await service.get(url, labels).catch(() => {});

        expect(metrics.increment).toHaveBeenCalledWith("requests_direct6", {
          country: "de",
          outcome: "http_503",
        });
      });

      it("passes the country of the host to the proxy service", async () => {
        const { service, proxy } = setupMetrics();
        get.mockResolvedValue({ data: "" });

        await service.get(url, labels);
        await service.get(url);

        expect(proxy.setCountry).toHaveBeenCalledTimes(1);
        expect(proxy.setCountry).toHaveBeenCalledWith("www.amazon.de", "de");
      });

      it("counts the outcome without labels", async () => {
        const { service, metrics } = setupMetrics();
        get.mockResolvedValue({ data: "" });

        await service.get(url);

        expect(metrics.increment).toHaveBeenCalledWith("requests", {
          outcome: "ok",
        });
      });

      it("records request_ms with the labels", async () => {
        const { service, metrics } = setupMetrics();
        get.mockResolvedValue({ data: "" });

        await service.get(url, labels);

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
    });

    describe("with stopAt", () => {
      const url = "https://www.amazon.de/dp/X";
      const stopAt = ["<b>", "&&&"];

      const setupStream = (chunks: (string | Buffer)[], error?: Error) => {
        const metrics = { increment: vi.fn() };
        const requests: Promise<unknown>[] = [];
        const queue = {
          request: vi.fn((cb: () => Promise<unknown>) => {
            requests.push(cb());
          }),
        };
        const service = new Client(
          { getAgent: vi.fn(), block: vi.fn(), getRoute: vi.fn(() => "proxy"), setCountry: vi.fn() },
          queue,
          metrics
        );
        const stream = Readable.from(
          (async function* () {
            for (const chunk of chunks) yield Buffer.from(chunk);
            if (error) throw error;
          })()
        );
        get.mockResolvedValue({ data: stream });
        const run = (markers: StopAt = stopAt) => service.get<string>(url, { stopAt: markers });

        return { run, metrics, stream };
      };

      it("reads the response as a stream and cuts it after the last marker", async () => {
        const { run, metrics, stream } = setupStream(["<a>", "<b>x&&&y", "rest"]);

        await expect(run()).resolves.toBe("<a><b>x&&&y");

        expect(get.mock.calls[0][1]).toMatchObject({ responseType: "stream" });
        expect(stream.destroyed).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "ok" });
      });

      it("cuts at markers split across chunks", async () => {
        const { run } = setupStream(["<a><", "b>x&&", "&y", "rest"]);

        await expect(run()).resolves.toBe("<a><b>x&&&y");
      });

      it("ignores a later marker seen before the earlier one", async () => {
        const { run } = setupStream(["&&&", "<b>", "x&&&", "rest"]);

        await expect(run()).resolves.toBe("&&&<b>x&&&");
      });

      it("cuts at whichever alternative marker comes first", async () => {
        const first = setupStream(["<b>x", "&&&y", "##z", "rest"]);
        await expect(first.run(["<b>", ["##", "&&&"]])).resolves.toBe("<b>x&&&y");

        const second = setupStream(["<b>x#", "#y", "&&&z", "rest"]);
        await expect(second.run(["<b>", ["##", "&&&"]])).resolves.toBe("<b>x##y");
      });

      it("passes the whole response when the markers never arrive", async () => {
        const { run } = setupStream(["<a>", "<b>"]);

        await expect(run()).resolves.toBe("<a><b>");
      });

      it("decodes a character split across chunks", async () => {
        const euro = Buffer.from("€");
        const { run } = setupStream([euro.subarray(0, 1), euro.subarray(1)]);

        await expect(run(["x"])).resolves.toBe("€");
      });

      it("rejects on a stream error and counts it once", async () => {
        const { run, metrics } = setupStream(["<a>"], new Error("reset"));

        await expect(run()).rejects.toThrow("reset");

        const counted = metrics.increment.mock.calls.filter(([name]) => name === "requests");
        expect(counted).toEqual([["requests", { outcome: "network" }]]);
      });

      it("drains the body of an error response so the connection is freed", async () => {
        const { run } = setupStream([]);
        const body = Readable.from([Buffer.from("not found")]);
        get.mockReset();
        const error = { response: { status: 404, data: body } };
        get.mockRejectedValue(error);

        await expect(run()).rejects.toBe(error);
        await new Promise((resolve) => body.once("end", resolve));

        expect(body.readableEnded).toBe(true);
      });

      it("counts a stream cancelled by the timeout as timeout", async () => {
        const error = Object.assign(new Error("canceled"), { code: "ERR_CANCELED" });
        const { run, metrics } = setupStream(["<a>"], error);

        await expect(run()).rejects.toBe(error);

        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "timeout" });
      });
    });

    it("resolves to undefined for a request cancelled while queued", async () => {
      const { service, proxy } = setup();

      await expect(
        service.get("https://www.amazon.de/dp/B0TESTASIN", { isCancelled: () => true })
      ).resolves.toBeUndefined();

      expect(get).not.toHaveBeenCalled();
      expect(proxy.getAgent).not.toHaveBeenCalled();
    });
  });
});
