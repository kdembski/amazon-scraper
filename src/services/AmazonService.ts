import axios, { GenericAbortSignal } from "axios";
import UserAgent from "user-agents";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ArgsService } from "@/services/ArgsService";
import { CronJob } from "cron";
import { ApiService } from "@/services/ApiService";
import { ProxyService } from "@/services/ProxyService";

export class AmazonService {
  private static instance: AmazonService;
  private baseUrl = "https://www.amazon.";
  private timeout = 20 * 1000;
  private apiService;
  private proxyService;
  queueService;

  private constructor(
    argsService = ArgsService.getInstance(),
    apiService = ApiService.getInstance(),
    proxyService = ProxyService.getInstance(),
    queueService = new RequestQueueService(
      argsService.getLimitFlag(),
      argsService.getRateFlag(),
      true,
      false // regulation temporarily disabled (was: argsService.getTargetFlag().isPdp)
    )
  ) {
    this.queueService = queueService;
    this.apiService = apiService;
    this.proxyService = proxyService;
    queueService.start();

    if (argsService.getTargetFlag().isPdp) {
      new CronJob("0 50 */1 * * *", () => this.sendScraperStatus()).start();
    }
  }

  public static getInstance(): AmazonService {
    if (!AmazonService.instance) {
      AmazonService.instance = new AmazonService();
    }

    return AmazonService.instance;
  }

  get<T>(
    url: string,
    referer?: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    }
  ) {
    this.queueService.request(async () => {
      const httpsAgent = this.proxyService.getRandomAgent();
      const userAgent = new UserAgent().toString();

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(`${this.baseUrl}${url}`, {
            httpsAgent,
            // Hard limit for the whole request; axios `timeout` does not
            // cover a proxy that hangs on CONNECT
            signal: AbortSignal.timeout(this.timeout),
            headers: {
              "User-Agent": userAgent,
              Referer: `${this.baseUrl}${referer}`,
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    });
  }

  private sendScraperStatus() {
    this.apiService.post(`scrapers/${process.env.name}/status`, {
      speed: this.queueService.speed,
      pending: this.queueService.pending,
    });
  }
}
