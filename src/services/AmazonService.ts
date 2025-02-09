import axios from "axios";
import UserAgent from "user-agents";
import { HttpsProxyAgent } from "https-proxy-agent";
import { readFileSync } from "node:fs";
import { Proxy } from "@/types/amazon.types";
import { RequestQueueService } from "@/services/RequestQueueService";

export class AmazonService {
  private static instance: AmazonService;
  private proxies: Proxy[] = [];
  queueService;

  private constructor(queueService = new RequestQueueService(20)) {
    this.queueService = queueService;
    queueService.start();
    this.setupProxies();
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
    priority?: boolean
  ) {
    this.queueService.request(() => {
      const proxy = this.getRandomProxy();

      const userAgent = new UserAgent().toString();
      const httpsAgent = new HttpsProxyAgent("http://" + proxy.ip, {
        keepAlive: true,
      });

      return new Promise<void>(async (resolve) => {
        return axios
          .get<T>(url, {
            httpsAgent,
            headers: {
              "User-Agent": userAgent,
              Referer: referer,
              "Referrer-Policy": "strict-origin-when-cross-origin",
            },
            adapter: "fetch",
            fetchOptions: { priority: "low" },
          })
          .then((response) => {
            callback?.onSuccess?.(response.data);
            //console.log(`Amazon: ${response.status}`);
          })
          .catch((e) => {
            callback?.onError?.(e);
            //console.log(`Amazon: ${e.message}`);
          })
          .finally(() => {
            callback?.onFinally?.();
            resolve();
          });
      });
    }, priority);
  }

  private setupProxies() {
    const data = readFileSync("proxies.txt", "utf-8");
    this.proxies = (
      data.includes("\r\n") ? data.split("\r\n") : data.split("\n")
    ).map((proxy) => ({ ip: proxy, blocked: false }));
  }

  private getRandomProxy() {
    let proxy: Proxy;

    do {
      proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
    } while (!proxy || proxy.blocked);

    return proxy;
  }
}
