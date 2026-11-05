import { CronJob } from "cron";
import _ from "lodash";
import type http from "node:http";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyList } from "@/shared/http/proxy/ProxyList";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { tcpPing } from "@/shared/utils/tcpPing";

// IPv6 address of one.one.one.one, reachable only when the server has IPv6
const IPV6_PING_HOST = "2606:4700:4700::1111";

export class ProxyService {
  private static instance: ProxyService;
  private pools: Record<string, string[]> = {};
  private loading?: Promise<void>;
  private directFamilies: (4 | 6)[] = [4];
  private nextDirect = 0;

  private constructor(
    private meter = new ProxyTrafficMeter(),
    private pool = new ProxyAgentPool((socket, host, route) =>
      meter.track(socket, host, route)
    ),
    private list = new ProxyList(),
    private pingIpv6 = () => tcpPing(IPV6_PING_HOST, 443, 2000)
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
  // a random one; "direct" connects without a proxy
  // over the server's IPv4 and IPv6 in turn, "mixedN/M" directly for N minutes
  // and through datacenter proxies for the next M (M = N when left out); both fall back
  // to datacenter proxies while the host blocks every direct family
  getAgent(host: string, proxyType = "datacenter") {
    if (proxyType === "direct" || this.isDirectWindow(proxyType)) {
      const direct = this.getDirect(host);
      if (direct) return direct;
    }

    const proxies = this.getProxies(proxyType);
    const url =
      this.pool.takeLastFree(host, (url) => proxies.includes(url)) ??
      this.getRandomProxy(proxies);

    return this.pool.get(url);
  }

  block(agent: http.Agent, host: string) {
    this.pool.block(agent, host);
  }

  getRoute(agent: http.Agent) {
    return this.pool.getRoute(agent);
  }

  setCountry(host: string, country: string) {
    this.meter.setCountry(host, country);
  }

  private isDirectWindow(proxyType: string) {
    const mixed = proxyType.match(/^mixed(\d+)(?:\/(\d+))?$/);
    const direct = Number(mixed?.[1]);
    if (!direct) return false;

    const proxy = Number(mixed?.[2] ?? direct);
    const minute = Math.floor(Date.now() / (60 * 1000));

    return minute % (direct + proxy) < direct;
  }

  private getDirect(host: string) {
    const families = this.directFamilies.filter(
      (family) => !this.pool.isDirectBlocked(family, host)
    );
    if (!families.length) return;

    return this.pool.getDirect(families[this.nextDirect++ % families.length]);
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
    this.loading ??= Promise.all([this.list.load(), this.pingIpv6()])
      .then(([pools, ipv6]) => {
        this.pools = pools;
        this.pool.retain(_.flatten(Object.values(pools)));
        this.directFamilies = ipv6 === undefined ? [4] : [4, 6];
        console.log(
          "Proxies: " +
            _.map(pools, (urls, type) => `${type} ${urls.length}`).join(", ") +
            `, direct IPv${this.directFamilies.join("+IPv")}`
        );
      })
      .finally(() => {
        this.loading = undefined;
      });

    return this.loading;
  }
}
