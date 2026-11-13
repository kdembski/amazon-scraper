import { CronJob } from "cron";
import _ from "lodash";
import type net from "node:net";
import { Http2SessionPool } from "@/shared/http/proxy/Http2SessionPool";
import { ProxyAgentPool } from "@/shared/http/proxy/ProxyAgentPool";
import { ProxyList } from "@/shared/http/proxy/ProxyList";
import { ProxyRouteSelector } from "@/shared/http/proxy/ProxyRouteSelector";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import { tcpPing } from "@/shared/utils/tcpPing";
import type { ProxyPlan, Route, ShopHandle, ShopPool } from "@/shared/http/http.types";

// IPv6 address of one.one.one.one, reachable only when the server has IPv6
const IPV6_PING_HOST = "2606:4700:4700::1111";

export class ProxyService {
  private static instance: ProxyService;
  private plans: ProxyPlan[] = [];
  private urls = new Set<string>();
  private totalWeight = 0;
  private loading?: Promise<void>;

  private constructor(
    private meter = new ProxyTrafficMeter(),
    private pool: ShopPool<ShopHandle> = ProxyService.createPool((socket, host, route) =>
      meter.track(socket, host, route)
    ),
    private list = new ProxyList(),
    private pingIpv6 = () => tcpPing(IPV6_PING_HOST, 443, 2000),
    private routes = new ProxyRouteSelector(pool)
  ) {
    new CronJob("0 0 */1 * * *", async () => {
      await this.loadProxies();
    }).start();
  }

  private static createPool(onConnect: (socket: net.Socket, host: string, route: Route) => void) {
    if (process.env.HTTP2 === "1") return new Http2SessionPool(onConnect);

    return new ProxyAgentPool(onConnect);
  }

  public static getInstance(): ProxyService {
    if (!ProxyService.instance) {
      ProxyService.instance = new ProxyService();
    }

    return ProxyService.instance;
  }

  // Direct agent when the route selector gives one, else the proxy freed last
  // for the host, else a random one of a plan picked by weight
  getAgent(host: string, proxyType = "datacenter") {
    const direct = this.routes.getDirect(host, proxyType);
    if (direct) return direct;

    const url =
      this.pool.takeLastFree(host, (url) => this.urls.has(url)) ?? this.getRandomProxy();

    return this.pool.get(url);
  }

  block(agent: ShopHandle, host: string) {
    this.pool.block(agent, host);
  }

  getRoute(agent: ShopHandle) {
    return this.pool.getRoute(agent);
  }

  setCountry(host: string, country: string) {
    this.meter.setCountry(host, country);
  }

  private getRandomProxy() {
    const { urls } = this.pickPlan();
    return urls[Math.floor(Math.random() * urls.length)];
  }

  // Plan with a chance proportional to its weight; any plan when all are 0
  private pickPlan() {
    let left = Math.random() * this.totalWeight;
    const plan = this.plans.find((plan) => (left -= plan.weight) < 0);
    if (plan) return plan;

    return this.plans[Math.floor(Math.random() * this.plans.length)] ?? { urls: [] };
  }

  countConnections() {
    return this.pool.countConnections();
  }

  collectTraffic() {
    return this.meter.collect();
  }

  loadProxies() {
    this.loading ??= Promise.all([this.list.load(), this.pingIpv6()])
      .then(([plans, ipv6]) => {
        this.plans = plans.filter((plan) => plan.urls.length);
        this.urls = new Set(this.plans.flatMap((plan) => plan.urls));
        this.totalWeight = _.sumBy(this.plans, "weight");
        this.pool.retain([...this.urls]);
        this.routes.directFamilies = ipv6 === undefined ? [4] : [4, 6];
        console.log(
          `Proxies: datacenter ${this.urls.size} (${this.describePlans()}), ` +
            `direct IPv${this.routes.directFamilies.join("+IPv")}`
        );
      })
      .finally(() => {
        this.loading = undefined;
      });

    return this.loading;
  }

  private describePlans() {
    return this.plans
      .map((plan) => {
        const share = this.totalWeight ? plan.weight / this.totalWeight : 0;
        return `${plan.urls.length} ${Math.round(share * 100)}%`;
      })
      .join(", ");
  }
}
