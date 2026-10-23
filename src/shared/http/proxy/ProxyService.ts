import { CronJob } from "cron";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyList } from "@/shared/http/proxy/ProxyList";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";

export class ProxyService {
  private static instance: ProxyService;
  private proxies: string[] = [];
  private loading?: Promise<void>;
  private idleSearchSize = 20;

  private constructor(
    private meter = new ProxyTrafficMeter(),
    private pool = new ProxyAgentPool((socket) => meter.track(socket)),
    private list = new ProxyList()
  ) {
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

  // Random proxy, preferring one with an idle connection to the host among a
  // few random picks
  getAgent(host: string) {
    for (let i = 0; i < this.idleSearchSize; i++) {
      const url = this.getRandomProxy();
      if (this.pool.hasFreeSocket(url, host)) return this.pool.get(url);
    }

    return this.pool.get(this.getRandomProxy());
  }

  private getRandomProxy() {
    return this.proxies[Math.floor(Math.random() * this.proxies.length)];
  }

  countConnections() {
    return this.pool.countConnections();
  }

  collectTraffic() {
    return this.meter.collect();
  }

  loadProxies() {
    this.loading ??= this.list
      .load()
      .then((urls) => {
        this.proxies = urls;
        this.pool.retain(urls);
      })
      .finally(() => {
        this.loading = undefined;
      });

    return this.loading;
  }
}
