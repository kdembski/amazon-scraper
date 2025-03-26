import axios from "axios";
import { CronJob } from "cron";

export class ProxyService {
  private static instance: ProxyService;
  private proxies: string[] = [];

  private constructor() {
    this.loadProxies();

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

  private loadProxies() {
    return new Promise((resolve) => {
      const url = `https://api.proxyscrape.com/v2/account/datacenter_shared/proxy-list?auth=${process.env.PROXY_API_KEY}&type=getproxies&protocol=http`;
      axios
        .get<string>(url)
        .then((response) => {
          const data = response.data;
          let array = data.includes("\r\n")
            ? data.split("\r\n")
            : data.split("\n");

          array = array.filter((v) => !!v);
          this.proxies = array;

          resolve(data);
        })
        .catch((e) => {
          console.log(e.message);
          setTimeout(this.loadProxies, 2 * 60 * 1000);
        });
    });
  }

  getRandomProxy() {
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
  }
}
