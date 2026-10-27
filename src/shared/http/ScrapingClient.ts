import axios from "axios";
import _ from "lodash";
import { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { RequestQueueService } from "@/shared/http/RequestQueueService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { MetricLabels, RequestOutcome } from "@/shared/metrics/metrics.types";

export class ScrapingClient {
  private static instance: ScrapingClient;
  private timeout = 20 * 1000;
  private userAgents = [138, 139, 140, 141].map(
    (version) =>
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`
  );
  private proxyService;
  private metricsService;
  queueService;

  private constructor(
    configService = ScraperConfigService.getInstance(),
    proxyService = ProxyService.getInstance(),
    queueService = new RequestQueueService(
      configService.get().concurrency,
      configService.get().rps,
      true,
      () => proxyService.countConnections()
    ),
    metricsService = MetricsService.getInstance()
  ) {
    this.metricsService = metricsService;
    this.queueService = queueService;
    this.proxyService = proxyService;
    queueService.start();
  }

  public static getInstance(): ScrapingClient {
    if (!ScrapingClient.instance) {
      ScrapingClient.instance = new ScrapingClient();
    }

    return ScrapingClient.instance;
  }

  get<T>(
    url: string,
    referer?: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      isCancelled?: () => boolean;
    },
    labels: MetricLabels = {},
    proxyType?: string
  ) {
    this.queueService.request(async () => {
      if (callback?.isCancelled?.()) return;

      let httpsAgent;
      try {
        httpsAgent = this.proxyService.getAgent(new URL(url).hostname, proxyType);
      } catch (e) {
        callback?.onError?.(e);
        return;
      }
      const userAgent = _.sample(this.userAgents);

      const startedAt = Date.now();
      let recorded = false;
      const record = (outcome: RequestOutcome) => {
        if (recorded) return;
        recorded = true;
        this.metricsService.increment("requests", { ...labels, outcome });
        this.metricsService.increment(
          "request_ms",
          labels,
          Date.now() - startedAt
        );
      };

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(url, {
            httpsAgent,
            // Hard limit for the whole request; axios `timeout` does not
            // cover a proxy that hangs on CONNECT
            signal: AbortSignal.timeout(this.timeout),
            headers: {
              "User-Agent": userAgent,
              Referer: referer,
              "Accept-Encoding": "gzip, deflate, br",
            },
          })
          .then((response) => {
            record("ok");
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            record(
              e?.response?.status
                ? `http_${e.response.status}`
                : e?.code === "ERR_CANCELED"
                  ? "timeout"
                  : "network"
            );
            callback?.onError?.(e);
          })
          .finally(() => resolve());
      });
    });
  }
}
