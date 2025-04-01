import axios from "axios";
import { CronJob } from "cron";
import { Proxy, WebshareProxy } from "@/types/proxy.types";
import { HttpsProxyAgent } from "https-proxy-agent";
export class ProxyService {
  private static instance: ProxyService;
  private proxies: Proxy[] = [];
  private isLoading = false;

  private constructor() {
    new CronJob("0 0 */1 * * *", async () => {
      await this.loadProxies();
    }).start();
  }

  public static getInstance(): ProxyService {
    if (!ProxyService.instance) {
      ProxyService.instance = new ProxyService();
    }

    return ProxyService.instance;
  }

  getRandomProxy() {
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
  }

  getRandomProxyAgent() {
    const { address, port, username, password } = this.getRandomProxy();
    return new HttpsProxyAgent(
      `http://${username}:${password}@${address}:${port}`,
      { keepAlive: true }
    );
  }

  loadProxies() {
    return new Promise<void>((resolve) => {
      if (this.isLoading) {
        setTimeout(() => {
          if (this.proxies.length) {
            resolve();
            return;
          }

          this.intervalLoad(resolve);
        }, 2 * 60 * 1000);
        return;
      }

      this.isLoading = true;
      this.intervalLoad(resolve);
    });
  }

  private intervalLoad(resolve: () => void) {
    const url =
      "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=500";

    axios
      .get<{ results: WebshareProxy[] }>(url, {
        headers: { Authorization: `Token ${process.env.PROXY_API_KEY}` },
      })
      .then((response) => {
        const data = response.data.results;
        this.proxies = this.formatProxies(data);
        this.isLoading = false;
        resolve();
      })
      .catch((e) => {
        console.log("Proxy error: " + e);
        setTimeout(() => this.intervalLoad(resolve), 2 * 60 * 1000);
      });
  }

  private formatProxies(data: WebshareProxy[]) {
    return data.map((proxy) => ({
      username: proxy.username,
      password: proxy.password,
      address: proxy.proxy_address,
      port: proxy.port,
    }));
  }
}
