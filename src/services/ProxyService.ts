import axios from "axios";
import { CronJob } from "cron";

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

  async getRandomProxy() {
    if (!this.proxies.length) {
      await this.loadProxies();
    }
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
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
    const url = `https://api.proxyscrape.com/v2/account/datacenter_shared/proxy-list?auth=${process.env.PROXY_API_KEY}&type=getproxies&protocol=http`;
    axios
      .get<string>(url)
      .then((response) => {
        const data = response.data;
        this.proxies = this.formatProxies(data);
        this.isLoading = false;
        resolve();
      })
      .catch(() => {
        setTimeout(() => this.intervalLoad(resolve), 2 * 60 * 1000);
      });
  }

  private formatProxies(data: string) {
    let array = data.includes("\r\n") ? data.split("\r\n") : data.split("\n");
    array = array.filter((v) => !!v);
    return array;
  }
}
