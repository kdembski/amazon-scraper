import { Readable } from "node:stream";
import _ from "lodash";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpStatusError } from "@/shared/http/HttpStatusError";
import { ScrapingClient } from "@/shared/http/ScrapingClient";
import type { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";

// The constructor is private, it is only called through getInstance()
const Client = ScrapingClient as unknown as new (
  ...deps: unknown[]
) => ScrapingClient;

const url = "https://www.amazon.de/dp/X?th=1";

const respond = (status: number, body: string | string[] = "", headers = {}) => ({
  status,
  headers,
  body: Readable.from(_.castArray(body).map((chunk) => Buffer.from(chunk))),
});

const setup = (route = "proxy") => {
  const request = vi.fn();
  const endpoint = { request } as unknown as Http2Endpoint;
  const metrics = { increment: vi.fn() };
  const proxy = {
    getEndpoint: vi.fn(() => endpoint),
    report: vi.fn(),
    getRoute: vi.fn(() => route),
    setCountry: vi.fn(),
  };
  const requests: Promise<unknown>[] = [];
  const queue = {
    request: vi.fn((callback: () => Promise<unknown>) => {
      requests.push(callback());
    }),
  };
  const service = new Client(proxy, queue, metrics);

  return { service, endpoint, request, metrics, proxy, queue, requests };
};

describe("ScrapingClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("requests the path through the queue on an endpoint of the proxy type", async () => {
      const { service, request, proxy, queue } = setup();
      request.mockResolvedValue(respond(200, "<html>"));

      await expect(
        service.get(url, { referer: "https://www.amazon.de/s?k=X", proxyType: "isp" })
      ).resolves.toBe("<html>");

      expect(queue.request).toHaveBeenCalledTimes(1);
      expect(proxy.getEndpoint).toHaveBeenCalledWith("www.amazon.de", "isp");
      expect(request).toHaveBeenCalledWith(
        "www.amazon.de",
        "/dp/X?th=1",
        [["referer", "https://www.amazon.de/s?k=X"]],
        expect.any(AbortSignal)
      );
    });

    it("sends no headers without a referer", async () => {
      const { service, request } = setup();
      request.mockResolvedValue(respond(200, "<html>"));

      await service.get(url);

      expect(request.mock.calls[0][2]).toEqual([]);
    });

    it("frees the queue slot only after the caller has handled the result", async () => {
      const { service, request, requests } = setup();
      request.mockResolvedValue(respond(200, "<html>"));
      const order: string[] = [];

      const handled = service.get(url).then(async () => {
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

    it.each([403, 429])("reports a %s as blocked before rejecting", async (status) => {
      const { service, endpoint, request, proxy } = setup("direct4");
      request.mockResolvedValue(respond(status));

      const onRejected = vi.fn((e) => {
        expect(e).toBeInstanceOf(HttpStatusError);
        expect(proxy.report).toHaveBeenCalledWith(endpoint, "www.amazon.de", "blocked");
      });

      await service.get(url).catch(onRejected);

      expect(onRejected).toHaveBeenCalled();
    });

    it("reports a 503 as throttled", async () => {
      const { service, endpoint, request, proxy } = setup();
      request.mockResolvedValue(respond(503));

      await expect(service.get(url)).rejects.toMatchObject({ status: 503 });

      expect(proxy.report).toHaveBeenCalledWith(endpoint, "www.amazon.de", "throttled");
    });

    it("reports a captcha page as throttled", async () => {
      const { service, endpoint, request, proxy } = setup();
      request.mockResolvedValue(respond(200, "<captcha>"));

      await expect(service.get(url, { isCaptcha: (body) => body === "<captcha>" })).resolves.toBe("<captcha>");

      expect(proxy.report).toHaveBeenCalledWith(endpoint, "www.amazon.de", "throttled");
    });

    it.each([404])("reports a %s as ok", async (status) => {
      const { service, endpoint, request, proxy } = setup();
      request.mockResolvedValue(respond(status));

      await expect(service.get(url)).rejects.toMatchObject({ status });

      expect(proxy.report).toHaveBeenCalledWith(endpoint, "www.amazon.de", "ok");
    });

    it("reports a success as not blocked", async () => {
      const { service, endpoint, request, proxy } = setup();
      request.mockResolvedValue(respond(200, "<html>"));

      await service.get(url);

      expect(proxy.report).toHaveBeenCalledOnce();
      expect(proxy.report).toHaveBeenCalledWith(endpoint, "www.amazon.de", "ok");
    });

    it("rejects with the error and still finishes the queued task", async () => {
      const { service, request, requests } = setup();
      const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
      request.mockRejectedValue(error);

      await expect(service.get(url)).rejects.toBe(error);
      await expect(Promise.all(requests)).resolves.toBeDefined();
    });

    it("rejects with an error thrown before the request and still finishes the queued task", async () => {
      const { service, request, proxy, requests } = setup();
      const error = new Error("no proxy");
      proxy.getEndpoint.mockImplementation(() => {
        throw error;
      });

      await expect(service.get(url)).rejects.toBe(error);
      await expect(Promise.all(requests)).resolves.toBeDefined();

      expect(request).not.toHaveBeenCalled();
    });

    it("resolves to undefined for a request cancelled while queued", async () => {
      const { service, proxy } = setup();

      await expect(service.get(url, { isCancelled: () => true })).resolves.toBeUndefined();

      expect(proxy.getEndpoint).not.toHaveBeenCalled();
    });

    describe("metrics", () => {
      const labels = { labels: { country: "de" } };

      it("counts a successful request with the country label", async () => {
        const { service, request, metrics } = setup("direct6");
        request.mockResolvedValue(respond(200, "<html>"));

        await service.get(url, labels);

        expect(metrics.increment).toHaveBeenCalledWith("requests", { country: "de", outcome: "ok" });
      });

      it("counts the request also under the route of its endpoint", async () => {
        const { service, request, metrics } = setup("direct6");
        request.mockResolvedValue(respond(503));

        await service.get(url, labels).catch(() => {});

        expect(metrics.increment).toHaveBeenCalledWith("requests_direct6", {
          country: "de",
          outcome: "http_503",
        });
      });

      it("counts a network error under its code and route", async () => {
        const { service, request, metrics } = setup("direct6");
        request.mockRejectedValue(Object.assign(new Error("reset"), { code: "ECONNRESET" }));

        await service.get(url, labels).catch(() => {});

        expect(metrics.increment).toHaveBeenCalledWith("requests", { country: "de", outcome: "network" });
        expect(metrics.increment).toHaveBeenCalledWith("network_errors_direct6", {
          country: "de",
          outcome: "ECONNRESET",
        });
      });

      it("counts no network error for other outcomes", async () => {
        const { service, request, metrics } = setup("direct6");
        request.mockResolvedValue(respond(503));

        await service.get(url, labels).catch(() => {});

        const names = metrics.increment.mock.calls.map(([name]) => name);
        expect(names).not.toContain("network_errors_direct6");
      });

      it("passes the country of the host to the proxy service", async () => {
        const { service, request, proxy } = setup();
        request.mockImplementation(async () => respond(200));

        await service.get(url, labels);
        await service.get(url);

        expect(proxy.setCountry).toHaveBeenCalledTimes(1);
        expect(proxy.setCountry).toHaveBeenCalledWith("www.amazon.de", "de");
      });

      it("counts the outcome without labels", async () => {
        const { service, request, metrics } = setup();
        request.mockResolvedValue(respond(200));

        await service.get(url);

        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "ok" });
      });

      it("records request_ms with the labels", async () => {
        const { service, request, metrics } = setup();
        request.mockResolvedValue(respond(200));

        await service.get(url, labels);

        const call = metrics.increment.mock.calls.find(([name]) => name === "request_ms")!;
        expect(call[1]).toEqual({ country: "de" });
        expect(call[2]).toBeGreaterThanOrEqual(0);
      });

      it("records an abort after 20 s as timeout", async () => {
        vi.useFakeTimers();
        vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
          const aborter = new AbortController();
          setTimeout(() => aborter.abort(), ms);
          return aborter.signal;
        });
        const { service, request, metrics } = setup();
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
    });

    describe("response body", () => {
      it("cuts the text after the stopAt markers and destroys the stream", async () => {
        const { service, request, metrics } = setup();
        const response = respond(200, ["<a>", "<b>x&&&y", "rest"]);
        request.mockResolvedValue(response);

        await expect(service.get(url, { stopAt: ["<b>", "&&&"] })).resolves.toBe("<a><b>x&&&y");

        expect(response.body.destroyed).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "ok" });
      });

      it("rejects an error status, drains its body and records it", async () => {
        const { service, request, metrics } = setup();
        const response = respond(404, "not found");
        request.mockResolvedValue(response);

        await expect(service.get(url)).rejects.toMatchObject({ status: 404 });
        await new Promise((resolve) => response.body.once("end", resolve));

        expect(response.body.readableEnded).toBe(true);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "http_404" });
      });

      it("follows redirects to the same host and destroys their bodies", async () => {
        const { service, request } = setup();
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
        const { service, request, metrics } = setup();
        const redirect = respond(301, "", { location: "https://www.amazon.com/dp/X" });
        request.mockResolvedValue(redirect);

        await expect(service.get(url)).rejects.toMatchObject({ status: 301 });

        expect(redirect.body.destroyed).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
        expect(metrics.increment).toHaveBeenCalledWith("requests", { outcome: "http_301" });
      });

      it("rejects after 5 followed redirects", async () => {
        const { service, request } = setup();
        request.mockImplementation(async () => respond(302, "", { location: "/dp/X" }));

        await expect(service.get(url)).rejects.toMatchObject({ status: 302 });

        expect(request).toHaveBeenCalledTimes(6);
      });

      it("rejects a redirect without a location", async () => {
        const { service, request } = setup();
        request.mockResolvedValue(respond(304));

        await expect(service.get(url)).rejects.toMatchObject({ status: 304 });
      });

      it("destroys the body when reading it fails", async () => {
        const { service, request, metrics } = setup();
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
  });
});
