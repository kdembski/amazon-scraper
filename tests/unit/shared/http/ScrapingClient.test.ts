import axios from "axios";
import { Readable } from "node:stream";
import _ from "lodash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StopAt } from "@/shared/http/http.types";
import { HttpStatusError } from "@/shared/http/HttpStatusError";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
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

    it("frees the queue slot only after the caller has handled the result", async () => {
      const { service, requests } = setup();
      get.mockResolvedValue({ data: "<html>" });
      const order: string[] = [];

      const handled = service.get("https://www.amazon.de/dp/B0TESTASIN").then(async () => {
        await null;
        await null;
        await null;
        order.push("caller");
      });
      await requests[0];
      order.push("slot");
      await handled;

      expect(order).toEqual(["caller", "slot"]);
    });

    it("resolves to the response data", async () => {
      const { service } = setup();
      get.mockResolvedValue({ data: "<html>" });

      await expect(service.get("https://www.amazon.de/dp/B0TESTASIN")).resolves.toBe("<html>");
    });

    it.each([403, 429])("blocks the agent for the host on a %s before rejecting", async (status) => {
      const { service, agent, proxy } = setup();
      get.mockRejectedValue({ status, response: { status } });

      const onRejected = vi.fn(() => {
        expect(proxy.block).toHaveBeenCalledWith(agent, "www.amazon.de");
      });

      await service.get("https://www.amazon.de/dp/B0TESTASIN").catch(onRejected);

      expect(onRejected).toHaveBeenCalled();
    });

    it.each([404, 503])("does not block the agent on a %s", async (status) => {
      const { service, proxy } = setup();
      get.mockRejectedValue({ status, response: { status } });

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
        get.mockRejectedValue({ status: 503, response: { status: 503 } });

        await service.get(url, labels).catch(() => {});

        expect(metrics.increment).toHaveBeenCalledWith("requests_direct6", {
          country: "de",
          outcome: "http_503",
        });
      });

      it("counts a network error under its code and route", async () => {
        const { service, metrics } = setupMetrics();
        get.mockRejectedValue(Object.assign(new Error("reset"), { code: "ECONNRESET" }));

        await service.get(url, labels).catch(() => {});

        expect(metrics.increment).toHaveBeenCalledWith("network_errors_direct6", {
          country: "de",
          outcome: "ECONNRESET",
        });
      });

      it("counts no network error for other outcomes", async () => {
        const { service, metrics } = setupMetrics();
        get.mockRejectedValue({ status: 503, response: { status: 503 } });

        await service.get(url, labels).catch(() => {});

        const names = metrics.increment.mock.calls.map(([name]) => name);
        expect(names).not.toContain("network_errors_direct6");
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
        const error = { status: 404, response: { status: 404, data: body } };
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

    describe("over HTTP/2", () => {
      const url = "https://www.amazon.de/dp/X?th=1";

      const respond = (status: number, body: string | string[] = "", headers = {}) => ({
        status,
        headers,
        body: Readable.from(_.castArray(body).map((chunk) => Buffer.from(chunk))),
      });

      const setupHttp2 = (route = "proxy") => {
        const request = vi.fn();
        const endpoint = Object.assign(Object.create(Http2Endpoint.prototype), {
          request,
        }) as Http2Endpoint;
        const metrics = { increment: vi.fn() };
        const proxy = {
          getAgent: vi.fn(() => endpoint),
          block: vi.fn(),
          getRoute: vi.fn(() => route),
          setCountry: vi.fn(),
        };
        const queue = {
          request: vi.fn((cb: () => Promise<unknown>) => {
            cb();
          }),
        };
        const service = new Client(proxy, queue, metrics);

        return { service, endpoint, request, metrics, proxy };
      };

      it("requests the path with the query and only the referer header", async () => {
        const { service, request } = setupHttp2();
        request.mockResolvedValue(respond(200, "<html>"));

        await expect(
          service.get(url, { referer: "https://www.amazon.de/s?k=X" })
        ).resolves.toBe("<html>");

        expect(get).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledWith(
          "www.amazon.de",
          "/dp/X?th=1",
          [["referer", "https://www.amazon.de/s?k=X"]],
          expect.any(AbortSignal)
        );
      });

      it("sends no headers without a referer", async () => {
        const { service, request } = setupHttp2();
        request.mockResolvedValue(respond(200, "<html>"));

        await service.get(url);

        expect(request.mock.calls[0][2]).toEqual([]);
      });

      it("cuts the text after the stopAt markers and destroys the stream", async () => {
        const { service, request, metrics } = setupHttp2();
        const response = respond(200, ["<a>", "<b>x&&&y", "rest"]);
        request.mockResolvedValue(response);

        await expect(service.get(url, { stopAt: ["<b>", "&&&"] })).resolves.toBe("<a><b>x&&&y");

        expect(response.body.destroyed).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "ok" });
      });

      it("rejects an error status, drains its body and records it", async () => {
        const { service, request, metrics, proxy } = setupHttp2();
        const response = respond(404, "not found");
        request.mockResolvedValue(response);

        await expect(service.get(url)).rejects.toMatchObject({ status: 404 });
        await new Promise((resolve) => response.body.once("end", resolve));

        expect(response.body.readableEnded).toBe(true);
        expect(proxy.block).not.toHaveBeenCalled();
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "http_404" });
      });

      it.each([403, 429])("blocks the endpoint for the host on a %s", async (status) => {
        const { service, endpoint, request, proxy } = setupHttp2("direct4");
        request.mockResolvedValue(respond(status));

        await expect(service.get(url)).rejects.toBeInstanceOf(HttpStatusError);

        expect(proxy.block).toHaveBeenCalledWith(endpoint, "www.amazon.de");
      });

      it("records an abort after 20 s as timeout", async () => {
        vi.useFakeTimers();
        vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
          const aborter = new AbortController();
          setTimeout(() => aborter.abort(), ms);
          return aborter.signal;
        });
        const { service, request, metrics } = setupHttp2();
        request.mockImplementation(
          (_host: string, _path: string, _headers: unknown, signal: AbortSignal) =>
            new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () =>
                reject(Object.assign(new Error("Request aborted"), { code: "ETIMEDOUT" }))
              )
            )
        );

        const result = service.get(url).catch((e) => e);
        await vi.advanceTimersByTimeAsync(19_999);
        expect(metrics.increment).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        vi.useRealTimers();

        await expect(result).resolves.toMatchObject({ code: "ETIMEDOUT" });
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "timeout" });
      });

      it("follows redirects to the same host and destroys their bodies", async () => {
        const { service, request } = setupHttp2();
        const redirect = respond(301, "moved", { location: "/dp/Y" });
        request
          .mockResolvedValueOnce(redirect)
          .mockResolvedValueOnce(respond(302, "", { location: "https://www.amazon.de/dp/Z?a=1" }))
          .mockResolvedValueOnce(respond(200, "<html>"));

        await expect(service.get(url)).resolves.toBe("<html>");

        expect(redirect.body.destroyed).toBe(true);
        expect(request.mock.calls.map(([host, path]) => [host, path])).toEqual([
          ["www.amazon.de", "/dp/X?th=1"],
          ["www.amazon.de", "/dp/Y"],
          ["www.amazon.de", "/dp/Z?a=1"],
        ]);
      });

      it("rejects a redirect to another host and destroys its body", async () => {
        const { service, request, metrics } = setupHttp2();
        const redirect = respond(301, "", { location: "https://www.amazon.com/dp/X" });
        request.mockResolvedValue(redirect);

        await expect(service.get(url)).rejects.toMatchObject({ status: 301 });

        expect(redirect.body.destroyed).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "http_301" });
      });

      it("rejects after 5 followed redirects", async () => {
        const { service, request } = setupHttp2();
        request.mockImplementation(async () => respond(302, "", { location: "/dp/X" }));

        await expect(service.get(url)).rejects.toMatchObject({ status: 302 });

        expect(request).toHaveBeenCalledTimes(6);
      });

      it("rejects a redirect without a location", async () => {
        const { service, request } = setupHttp2();
        request.mockResolvedValue(respond(304));

        await expect(service.get(url)).rejects.toMatchObject({ status: 304 });
      });

      it("destroys the body when reading it fails", async () => {
        const { service, request, metrics } = setupHttp2();
        const body = Readable.from(
          (async function* () {
            yield Buffer.from("<a>");
            throw new Error("reset");
          })()
        );
        request.mockResolvedValue({ status: 200, headers: {}, body });

        await expect(service.get(url)).rejects.toThrow("reset");

        expect(body.destroyed).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "network" });
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
