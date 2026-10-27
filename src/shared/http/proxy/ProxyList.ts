import axios from "axios";
import { sleep } from "@/shared/utils/sleep";

type Pools = Record<string, string[]>;

interface WebsharePlan {
  id: number;
  status: string;
  proxy_subtype: string;
}

export class ProxyList {
  private retryDelay = 2 * 60 * 1000;
  private webshareUrl = "https://proxy.webshare.io/api/v2";

  async load(): Promise<Pools> {
    while (true) {
      try {
        return await this.downloadPools();
      } catch (e) {
        console.log("Proxy error: " + e);
        await sleep(this.retryDelay);
      }
    }
  }

  private async downloadPools(): Promise<Pools> {
    // PROXY_LIST_URL points the list at another source (used by e2e tests)
    if (process.env.PROXY_LIST_URL) {
      return { datacenter: await this.downloadList(process.env.PROXY_LIST_URL) };
    }
    return this.downloadWebsharePools();
  }

  private async downloadWebsharePools() {
    const pools: Pools = {};
    for (const plan of await this.getActivePlans()) {
      const pool = this.getPoolName(plan);
      const urls = await this.downloadList(this.getPlanListUrl(plan));
      pools[pool] = [...(pools[pool] ?? []), ...urls];
    }
    return pools;
  }

  private async getActivePlans() {
    const response = await axios.get<{ results: WebsharePlan[] }>(
      `${this.webshareUrl}/subscription/plan/`,
      { headers: { Authorization: `Token ${process.env.PROXY_API_KEY}` } }
    );
    return response.data.results.filter((plan) => plan.status === "active");
  }

  private getPoolName(plan: WebsharePlan) {
    return plan.proxy_subtype === "default" ? "datacenter" : plan.proxy_subtype;
  }

  private getPlanListUrl(plan: WebsharePlan) {
    const token = process.env.PROXY_LIST_TOKEN;
    return `${this.webshareUrl}/proxy/list/download/${token}/-/any/username/direct/-/?plan_id=${plan.id}`;
  }

  private async downloadList(url: string) {
    const { data } = await axios.get<string>(url);
    return data
      .split(/\r?\n/)
      .filter((line) => !!line)
      .map((line) => this.toUrl(line));
  }

  private toUrl(line: string) {
    const [host, port, username, password] = line.split(":");
    return `http://${username}:${password}@${host}:${port}`;
  }
}
