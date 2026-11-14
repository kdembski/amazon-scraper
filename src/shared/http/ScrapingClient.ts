import { text } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { HttpStatusError } from "@/shared/http/HttpStatusError";
import type { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { StopAtReader } from "@/shared/http/StopAtReader";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { toNetworkError } from "@/shared/metrics/toNetworkError";
import { toRequestOutcome } from "@/shared/metrics/toRequestOutcome";
import type { DirectResponse, Route, ScrapingRequest } from "@/shared/http/http.types";
import type { MetricLabels, RequestOutcome } from "@/shared/metrics/metrics.types";

export class ScrapingClient {
  private static instance: ScrapingClient;
  private timeout = 20 * 1000;

  private constructor(
    private proxyService = ProxyService.getInstance(),
    private queueService = TokenBucketQueue.getInstance(),
    private metricsService = MetricsService.getInstance(),
    private stopAtReader = new StopAtReader()
  ) {}

  public static getInstance(): ScrapingClient {
    if (!ScrapingClient.instance) {
      ScrapingClient.instance = new ScrapingClient();
    }

    return ScrapingClient.instance;
  }

  // Resolves to undefined when the request was cancelled while queued
  get<T>(url: string, request: ScrapingRequest = {}) {
    return new Promise<T | undefined>((resolve, reject) => {
      this.queueService.request(async () => {
        await this.execute<T>(url, request).then(resolve, reject);
        await setImmediate();
      });
    });
  }

  private async execute<T>(
    url: string,
    { referer, labels = {}, proxyType, stopAt, isCancelled, isCaptcha }: ScrapingRequest
  ): Promise<T | undefined> {
    if (isCancelled?.()) return;

    const host = new URL(url).hostname;
    const endpoint = this.proxyService.getEndpoint(host, proxyType);
    if (labels.country) this.proxyService.setCountry(host, labels.country);
    const route = this.proxyService.getRoute(endpoint);
    const startedAt = Date.now();

    try {
      const signal = AbortSignal.timeout(this.timeout);
      const data = await this.fetch(endpoint, url, { referer, stopAt }, signal);
      this.proxyService.report(endpoint, host, isCaptcha?.(data) ? "throttled" : "ok");
      this.record("ok", route, labels, startedAt);
      return data as T;
    } catch (e: any) {
      this.proxyService.report(endpoint, host, this.toDirectResponse(e?.status));
      const outcome = toRequestOutcome(e);
      this.record(outcome, route, labels, startedAt);
      if (outcome === "network") {
        this.metricsService.increment(`network_errors_${route}`, { ...labels, outcome: toNetworkError(e) });
      }
      throw e;
    }
  }

  private toDirectResponse(status?: number): DirectResponse {
    if (status === 403 || status === 429) return "blocked";
    return status === 503 ? "throttled" : "ok";
  }

  private async fetch(
    endpoint: Http2Endpoint,
    url: string,
    request: ScrapingRequest,
    signal: AbortSignal,
    hops = 0
  ): Promise<string> {
    const target = new URL(url);
    const headers: [string, string][] = request.referer ? [["referer", request.referer]] : [];
    const response = await endpoint.request(
      target.hostname,
      target.pathname + target.search,
      headers,
      signal
    );
    const { status, body } = response;

    if (status >= 300 && status < 400) {
      body.destroy();

      const location = response.headers.location;
      const next = location ? new URL(location, target) : undefined;
      if (!next || next.hostname !== target.hostname || hops >= 5) throw new HttpStatusError(status);

      return this.fetch(endpoint, next.href, request, signal, hops + 1);
    }

    if (status >= 400) {
      body.resume();
      throw new HttpStatusError(status);
    }

    try {
      return request.stopAt ? await this.stopAtReader.read(body, request.stopAt) : await text(body);
    } catch (e) {
      body.destroy();
      throw e;
    }
  }

  private record(
    outcome: RequestOutcome,
    route: Route,
    labels: MetricLabels,
    startedAt: number
  ) {
    this.metricsService.increment("requests", { ...labels, outcome });
    this.metricsService.increment(`requests_${route}`, { ...labels, outcome });
    this.metricsService.increment("request_ms", labels, Date.now() - startedAt);
  }
}
