import axios from "axios";
import UserAgent from "user-agents";
import { ArgsService } from "@/shared/args/ArgsService";
import { ProxyService } from "@/shared/http/ProxyService";
import { RequestQueueService } from "@/shared/http/RequestQueueService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { MetricLabels, RequestOutcome } from "@/shared/metrics/metrics.types";

export class ScrapingClient {
  private static instance: ScrapingClient;
  private timeout = 20 * 1000;
  private proxyService;
  private metricsService;
  queueService;

  private constructor(
    argsService = ArgsService.getInstance(),
    proxyService = ProxyService.getInstance(),
    queueService = new RequestQueueService(
      argsService.getLimitFlag(),
      argsService.getRateFlag(),
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
    },
    labels: MetricLabels = {}
  ) {
    this.queueService.request(async () => {
      const httpsAgent = this.proxyService.getRandomAgent();
      const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();

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
              "Referrer-Policy": "strict-origin-when-cross-origin",
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
