import axios from "axios";
import { CronJob } from "cron";
import { HttpsProxyAgent } from "https-proxy-agent";

export class ProxyService {
  private static instance: ProxyService;
  private proxies: string[] = [];
  private agents = new Map<string, HttpsProxyAgent<string>>();
  private isLoading = false;
  private idleTimeout = 15 * 1000;

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

  private getRandomProxy() {
    const proxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
    return this.toUrl(proxy);
  }

  // One agent per proxy, so keep-alive connections (proxy tunnel + TLS
  // session) are reused instead of being set up for every request. Idle
  // connections are capped and closed after a while, otherwise they pile up
  // for every proxy x country pair and fill the router's NAT table
  getRandomAgent() {
    const proxy = this.getRandomProxy();
    let agent = this.agents.get(proxy);

    if (!agent) {
      agent = new HttpsProxyAgent(proxy, { keepAlive: true, maxFreeSockets: 1 });
      // HttpsProxyAgent replaces `options`, so a `timeout` passed to the
      // constructor never reaches http.Agent, which reads it from there to
      // close idle sockets
      agent.options.timeout = this.idleTimeout;
      this.agents.set(proxy, agent);
    }

    return agent;
  }

  // Open sockets of all proxy agents, in use and idle
  countConnections() {
    let count = 0;

    this.agents.forEach((agent) => {
      [agent.sockets, agent.freeSockets].forEach((pool) => {
        Object.values(pool).forEach((sockets) => {
          count += sockets?.length ?? 0;
        });
      });
    });

    return count;
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
    // PROXY_LIST_URL points the list at another source (used by e2e tests)
    const url =
      process.env.PROXY_LIST_URL ||
      `https://proxy.webshare.io/api/v2/proxy/list/download/${process.env.PROXY_LIST_TOKEN}/-/any/username/direct/-/`;

    axios
      .get<string>(url)
      .then((response) => {
        const data = response.data;
        this.proxies = this.formatProxies(data);
        this.removeStaleAgents();
        this.isLoading = false;
        resolve();
      })
      .catch((e) => {
        console.log("Proxy error: " + e);
        setTimeout(() => this.intervalLoad(resolve), 2 * 60 * 1000);
      });
  }

  // Close connections of proxies that are no longer on the list
  private removeStaleAgents() {
    const urls = new Set(this.proxies.map((proxy) => this.toUrl(proxy)));

    this.agents.forEach((agent, url) => {
      if (urls.has(url)) return;

      agent.destroy();
      this.agents.delete(url);
    });
  }

  private toUrl(proxy: string) {
    const parts = proxy.split(":");
    return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  }

  private formatProxies(data: string) {
    let array = data.includes("\r\n") ? data.split("\r\n") : data.split("\n");
    array = array.filter((v) => !!v);
    return array;
  }
}
