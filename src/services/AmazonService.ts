import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import UserAgent from "user-agents";
import { readFileSync } from "node:fs";

export class AmazonService {
  private static instance: AmazonService;
  private static pending = 0;
  private static queue: Function[] = [];
  private proxies;
  static pendingLimit = 10;

  private constructor() {
    const data = readFileSync("proxies.txt", "utf-8");
    this.proxies = data.includes("\r\n")
      ? data.split("\r\n")
      : data.split("\n");
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
    if (AmazonService.pending >= AmazonService.pendingLimit) {
      this.addToQueue(
        () => this.get(url, referer, callback, priority),
        priority
      );
      return;
    }

    const httpsAgent = new HttpsProxyAgent(
      "http://" + this.proxies[Math.floor(Math.random() * this.proxies.length)]
    );

    const userAgent = new UserAgent().toString();

    AmazonService.pending++;
    return new Promise<T>(async (resolve) => {
      return axios
        .get<T>(url, {
          httpsAgent,
          headers: {
            "User-Agent": userAgent,
            Referer: referer,
            "Referrer-Policy": "strict-origin-when-cross-origin",
          },
        })
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
          console.log(`Amazon: ${response.status}`);
        })
        .catch((e) => {
          callback?.onError?.(e);
          console.error(`Amazon: ${e.message}`);
        })
        .finally(() => {
          callback?.onFinally?.();
          AmazonService.pending--;

          const next = AmazonService.queue.shift();
          const delay = Math.floor(Math.random() * 1000);
          setTimeout(() => next?.(), delay);
        });
    });
  }

  private addToQueue = (callback: () => void, priority?: boolean) => {
    if (priority) {
      AmazonService.queue.unshift(callback);
      return;
    }

    AmazonService.queue.push(callback);
  };
}
