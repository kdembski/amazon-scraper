import axios from "axios";
import UserAgent from "user-agents";
import { HttpsProxyAgent } from "https-proxy-agent";
import { readFileSync } from "node:fs";
import { Proxy } from "@/types/amazon.types";

export class AmazonService {
  private static instance: AmazonService;
  private pending = 0;
  private pendingLimit = 30;
  private queue: Function[] = [];
  private proxies: Proxy[] = [];

  private constructor() {
    this.setupProxies();
    this.setupQueue();

    setInterval(() => {
      const blockedProxies = this.proxies.filter((p) => p.blocked).length;
      console.log(
        `pending: ${this.pending} queue: ${this.queue.length} blocked proxies: ${blockedProxies}`
      );
    }, 1000);
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
      onSuccess?: (data: { data: T; proxy: Proxy }) => void;
      onError?: (e: any) => void;
      onFinally?: () => void;
    },
    priority?: boolean
  ) {
    if (this.pending >= this.pendingLimit) {
      const queueItem = () => this.get(url, referer, callback, priority);
      this.addToQueue(queueItem, priority);
      return;
    }

    const proxy = this.getRandomProxy();
    const httpsAgent = new HttpsProxyAgent("http://" + proxy.ip);
    const userAgent = new UserAgent().toString();

    this.pending++;

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
          callback?.onSuccess?.({ data: response.data, proxy });
          resolve(response.data);
          //console.log(`Amazon: ${response.status}`);
        })
        .catch((e) => {
          callback?.onError?.(e);
          //console.log(`Amazon: ${e.message}`);
        })
        .finally(() => {
          callback?.onFinally?.();
          this.pending--;
        });
    });
  }

  private addToQueue = (callback: () => void, priority?: boolean) => {
    if (priority) {
      this.queue.unshift(callback);
      return;
    }

    this.queue.push(callback);
  };

  private shiftQueue() {
    if (this.pending >= this.pendingLimit) {
      return;
    }

    const next = this.queue.shift();
    next?.();
  }

  private setupQueue() {
    const delay = Math.floor(Math.random() * 100);

    setTimeout(() => {
      this.shiftQueue();
      this.setupQueue();
    }, delay);
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

  blockProxy(proxy: Proxy) {
    proxy.blocked = true;

    setTimeout(() => {
      proxy.blocked = false;
    }, 5 * 60 * 1000);
  }
}
