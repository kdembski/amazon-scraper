import { CronJob } from "cron";
import _ from "lodash";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyList } from "@/shared/http/proxy/ProxyList";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";

export class ProxyService {
  private static instance: ProxyService;
  private pools: Record<string, string[]> = {};
  private loading?: Promise<void>;

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

  // Proxy of the pool whose idle connection to the host was freed last, else
  // a random one
  getAgent(host: string, proxyType = "datacenter") {
    const proxies = this.getProxies(proxyType);
    const url =
      this.pool.takeLastFree(host, (url) => proxies.includes(url)) ??
      this.getRandomProxy(proxies);

    return this.pool.get(url);
  }

  private getProxies(proxyType: string) {
    return this.pools[proxyType]?.length
      ? this.pools[proxyType]
      : (this.pools.datacenter ?? []);
  }

  private getRandomProxy(proxies: string[]) {
    return proxies[Math.floor(Math.random() * proxies.length)];
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
      .then((pools) => {
        this.pools = pools;
        this.pool.retain(_.flatten(Object.values(pools)));
        console.log(
          "Proxies: " + _.map(pools, (urls, type) => `${type} ${urls.length}`).join(", ")
        );
      })
      .finally(() => {
        this.loading = undefined;
      });

    return this.loading;
  }
}
