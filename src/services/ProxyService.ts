import axios from "axios";
import { CronJob } from "cron";
import { HttpsProxyAgent } from "https-proxy-agent";
export class ProxyService {
  private static instance: ProxyService;
  private proxies: string[] = [];
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
    const proxy = this.getRandomProxy();
    const parts = proxy.split(":");
    return new HttpsProxyAgent(
      `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`,
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
    const url = `https://proxy.webshare.io/api/v2/proxy/list/download/${process.env.PROXY_LIST_TOKEN}/-/any/username/direct/-/`;

    axios
      .get<string>(url)
      .then((response) => {
        const data = response.data;
        this.proxies = this.formatProxies(data);
        this.isLoading = false;
        resolve();
      })
      .catch((e) => {
        console.log("Proxy error: " + e);
        setTimeout(() => this.intervalLoad(resolve), 2 * 60 * 1000);
      });
  }

  private formatProxies(data: string) {
    let array = data.includes("\r\n") ? data.split("\r\n") : data.split("\n");
    array = array.filter((v) => !!v);
    return array;
  }
}
