import axios from "axios";
import _ from "lodash";
import { sleep } from "@/shared/utils/sleep";
import type { ProxyPlan } from "@/shared/http/http.types";

interface WebsharePlan {
  id: number;
  status: string;
  proxy_subtype: string;
  bandwidth_limit: number;
}

interface WebsharePeriod {
  start_date: string;
  end_date: string;
}

export class ProxyList {
  private retryDelay = 2 * 60 * 1000;
  private minTimeLeft = 60 * 60 * 1000;
  private webshareUrl = "https://proxy.webshare.io/api/v2";

  async load(): Promise<ProxyPlan[]> {
    while (true) {
      try {
        return await this.downloadPlans();
      } catch (e) {
        console.log("Proxy error: " + e);
        await sleep(this.retryDelay);
      }
    }
  }

  private async downloadPlans(): Promise<ProxyPlan[]> {
    // PROXY_LIST_URL points the list at another source (used by e2e tests)
    if (process.env.PROXY_LIST_URL) {
      return [{ urls: await this.downloadList(process.env.PROXY_LIST_URL), weight: 1 }];
    }
    return this.downloadWebsharePlans();
  }

  private async downloadWebsharePlans() {
    const plans: ProxyPlan[] = [];
    for (const key of this.getApiKeys()) {
      const token = await this.getListToken(key);
      const period = await this.getPeriod(key);
      for (const plan of await this.getDatacenterPlans(key)) {
        const urls = await this.downloadList(this.getPlanListUrl(token, plan));
        const used = await this.getUsedBandwidth(key, plan, period).catch(() => 0);
        plans.push({ urls, weight: this.getWeight(plan, period, used) });
      }
    }
    return plans;
  }

  private getApiKeys() {
    return _.compact([process.env.PROXY_API_KEY, process.env.PROXY_API_KEY2]);
  }

  private getAuth(key: string) {
    return { headers: { Authorization: `Token ${key}` } };
  }

  private async getListToken(key: string) {
    const response = await axios.get<{ proxy_list_download_token: string }>(
      `${this.webshareUrl}/proxy/config/`,
      this.getAuth(key)
    );
    return response.data.proxy_list_download_token;
  }

  private async getPeriod(key: string) {
    const response = await axios.get<WebsharePeriod>(
      `${this.webshareUrl}/subscription/`,
      this.getAuth(key)
    );
    return response.data;
  }

  private async getDatacenterPlans(key: string) {
    const response = await axios.get<{ results: WebsharePlan[] }>(
      `${this.webshareUrl}/subscription/plan/`,
      this.getAuth(key)
    );
    return response.data.results.filter(
      (plan) => plan.status === "active" && plan.proxy_subtype === "default"
    );
  }

  private async getUsedBandwidth(key: string, plan: WebsharePlan, period: WebsharePeriod) {
    const response = await axios.get<{ bandwidth_total: number }>(
      `${this.webshareUrl}/stats/aggregate/`,
      {
        ...this.getAuth(key),
        params: {
          plan_id: plan.id,
          timestamp__gte: period.start_date,
          timestamp__lte: period.end_date,
        },
      }
    );
    return response.data.bandwidth_total;
  }

  private getWeight(plan: WebsharePlan, period: WebsharePeriod, used: number) {
    const left = Math.max(0, plan.bandwidth_limit * 1e9 - used);
    const timeLeft = Date.parse(period.end_date) - Date.now();

    return left / Math.max(this.minTimeLeft, timeLeft);
  }

  private getPlanListUrl(token: string, plan: WebsharePlan) {
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
