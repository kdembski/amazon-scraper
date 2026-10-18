import axios from "axios";
import UserAgent from "user-agents";
import { ArgsService } from "@/shared/args/ArgsService";
import { ProxyService } from "@/shared/http/ProxyService";
import { RequestQueueService } from "@/shared/http/RequestQueueService";

export class ScrapingClient {
  private static instance: ScrapingClient;
  private timeout = 20 * 1000;
  private proxyService;
  queueService;

  private constructor(
    argsService = ArgsService.getInstance(),
    proxyService = ProxyService.getInstance(),
    queueService = new RequestQueueService(
      argsService.getLimitFlag(),
      argsService.getRateFlag(),
      true,
      () => proxyService.countConnections()
    )
  ) {
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
    }
  ) {
    this.queueService.request(async () => {
      const httpsAgent = this.proxyService.getRandomAgent();
      const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();

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
            callback?.onSuccess?.(response.data);
          })
          .catch((e) => {
            callback?.onError?.(e);
          })
          .finally(() => resolve());
      });
    });
  }
}
