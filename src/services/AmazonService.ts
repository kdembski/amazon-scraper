import axios, { GenericAbortSignal } from "axios";
import UserAgent from "user-agents";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ArgsService } from "@/services/ArgsService";
import { CronJob } from "cron";
import { ApiService } from "@/services/ApiService";
import { ProxyService } from "@/services/ProxyService";
import { HttpsProxyAgent } from "https-proxy-agent";

export class AmazonService {
  private static instance: AmazonService;
  private baseUrl = "https://www.amazon.";
  private apiService;
  private proxyService;
  queueService;

  private constructor(
    argsService = ArgsService.getInstance(),
    apiService = ApiService.getInstance(),
    proxyService = ProxyService.getInstance(),
    queueService = new RequestQueueService(
      argsService.getLimitFlag(),
      true,
      argsService.getTargetFlag().isPdp
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
    },
    signal?: GenericAbortSignal
  ) {
    this.queueService.request(async () => {
      const proxy = this.proxyService.getRandomProxy();
      const userAgent = new UserAgent().toString();
      const httpsAgent = new HttpsProxyAgent(proxy, { keepAlive: true });

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(`${this.baseUrl}${url}`, {
            httpsAgent,
            headers: {
              "User-Agent": userAgent,
              Referer: `${this.baseUrl}${referer}`,
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
            signal,
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
