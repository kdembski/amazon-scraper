import { CronJob } from "cron";
import _ from "lodash";
import type http from "node:http";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyList } from "@/shared/http/proxy/ProxyList";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { RateLimiter } from "@/shared/http/proxy/RateLimiter";

export class ProxyService {
  private static instance: ProxyService;
  private pools: Record<string, string[]> = {};
  private loading?: Promise<void>;
  private limiters = new Map<string, RateLimiter>();

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
  // a random one not blocked by the host; "direct" connects without a proxy, "mixedN" directly up to
  // N rps per host and through datacenter proxies above
  getAgent(host: string, proxyType = "datacenter") {
    if (proxyType === "direct") return this.pool.getDirect();

    const mixed = proxyType.match(/^mixed(\d+)$/);
    if (mixed) {
      if (this.getLimiter(host, Number(mixed[1])).take()) return this.pool.getDirect();
      proxyType = "datacenter";
    }

    const proxies = this.getProxies(proxyType);
    const url =
      this.pool.takeLastFree(host, (url) => proxies.includes(url)) ??
      this.getRandomProxy(this.getUnblocked(proxies, host));

    return this.pool.get(url);
  }

  block(agent: http.Agent, host: string) {
    this.pool.block(agent, host);
  }

  // All proxies when the host blocked every one of them
  private getUnblocked(proxies: string[], host: string) {
    const unblocked = proxies.filter((url) => !this.pool.isBlocked(url, host));
    return unblocked.length ? unblocked : proxies;
  }

  private getLimiter(host: string, rps: number) {
    const key = `${host}:${rps}`;
    let limiter = this.limiters.get(key);

    if (!limiter) {
      limiter = new RateLimiter(rps);
      this.limiters.set(key, limiter);
    }

    return limiter;
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
