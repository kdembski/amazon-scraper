import axios from "axios";
import { HttpProxyAgent } from "http-proxy-agent";
import { readFileSync } from "node:fs";
import { HeaderGenerator } from "header-generator";
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
      onSuccess?: (data: T) => void;
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
    const httpAgent = new HttpProxyAgent("http://" + proxy.ip);
    const headers = new HeaderGenerator().getHeaders();
    delete headers["accept"];

    this.pending++;

    return new Promise<T>(async (resolve) => {
      return axios
        .get<T>(url, {
          httpAgent,
          headers: {
            ...headers,
            Referer: referer,
            "Referrer-Policy": "strict-origin-when-cross-origin",
          },
        })
        .then((response) => {
          callback?.onSuccess?.(response.data);
          resolve(response.data);
        })
        .catch((e) => {
          callback?.onError?.(e);
          this.blockProxy(proxy);
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

  private blockProxy(proxy: Proxy) {
    proxy.blocked = true;

    setTimeout(() => {
      proxy.blocked = false;
    }, 1 * 60 * 1000);
  }
}
