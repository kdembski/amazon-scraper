import axios from "axios";

interface WebsharePlan {
  id: number;
  status: string;
  proxy_subtype: string;
}

export class ProxyList {
  private retryDelay = 2 * 60 * 1000;
  private webshareUrl = "https://proxy.webshare.io/api/v2";

  load() {
    return new Promise<Record<string, string[]>>((resolve) => this.download(resolve));
  }

  private download(resolve: (pools: Record<string, string[]>) => void) {
    this.downloadPools()
      .then(resolve)
      .catch((e) => {
        console.log("Proxy error: " + e);
        setTimeout(() => this.download(resolve), this.retryDelay);
      });
  }

  private async downloadPools() {
    // PROXY_LIST_URL points the list at another source (used by e2e tests)
    if (process.env.PROXY_LIST_URL) {
      return { datacenter: await this.downloadList(process.env.PROXY_LIST_URL) };
    }

    const pools: Record<string, string[]> = {};
    for (const plan of await this.getActivePlans()) {
      const type = plan.proxy_subtype === "default" ? "datacenter" : plan.proxy_subtype;
      const urls = await this.downloadList(
        `${this.webshareUrl}/proxy/list/download/${process.env.PROXY_LIST_TOKEN}/-/any/username/direct/-/?plan_id=${plan.id}`
      );
      pools[type] = [...(pools[type] ?? []), ...urls];
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

  private async downloadList(url: string) {
    return this.parse((await axios.get<string>(url)).data);
  }

  private parse(data: string) {
    const lines = data.includes("\r\n") ? data.split("\r\n") : data.split("\n");
    return lines.filter((line) => !!line).map((line) => this.toUrl(line));
  }

  private toUrl(proxy: string) {
    const parts = proxy.split(":");
    return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  }
}
