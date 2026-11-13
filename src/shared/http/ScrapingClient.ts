import axios from "axios";
import type { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import _ from "lodash";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { StopAtReader } from "@/shared/http/StopAtReader";
import { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { toRequestOutcome } from "@/shared/metrics/toRequestOutcome";
import type { Route, ScrapingRequest } from "@/shared/http/http.types";
import type { MetricLabels, RequestOutcome } from "@/shared/metrics/metrics.types";

export class ScrapingClient {
  private static instance: ScrapingClient;
  private timeout = 20 * 1000;
  private userAgents = [138, 139, 140, 141].map(
    (version) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`
  );

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
    { referer, labels = {}, proxyType, stopAt, isCancelled }: ScrapingRequest
  ): Promise<T | undefined> {
    if (isCancelled?.()) return;

    const host = new URL(url).hostname;
    const httpsAgent = this.proxyService.getAgent(host, proxyType);
    if (labels.country) this.proxyService.setCountry(host, labels.country);
    const route = this.proxyService.getRoute(httpsAgent);
    const startedAt = Date.now();

    try {
      const response = await axios.get<T>(url, {
        httpsAgent,
        // Hard limit for the whole request; axios `timeout` does not
        // cover a proxy that hangs on CONNECT
        signal: AbortSignal.timeout(this.timeout),
        headers: {
          "User-Agent": _.sample(this.userAgents),
          Referer: referer,
          "Accept-Encoding": "gzip, deflate, br",
        },
        ...(stopAt && { responseType: "stream" }),
      });
      const data = stopAt
        ? ((await this.stopAtReader.read(response.data as Readable, stopAt)) as T)
        : response.data;
      this.record("ok", route, labels, startedAt);
      return data;
    } catch (e: any) {
      if (stopAt) e?.response?.data?.resume?.();
      if ([403, 429].includes(e?.status)) this.proxyService.block(httpsAgent, host);
      this.record(toRequestOutcome(e), route, labels, startedAt);
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
