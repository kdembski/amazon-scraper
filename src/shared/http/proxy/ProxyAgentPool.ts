import type net from "node:net";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";

export class ProxyAgentPool {
  private agents = new Map<string, MeteredProxyAgent>();
  private idleTimeout = 15 * 1000;

  constructor(private onConnect: (socket: net.Socket) => void) {}

  get(url: string) {
    let agent = this.agents.get(url);

    if (!agent) {
      agent = new MeteredProxyAgent(
        url,
        { keepAlive: true, maxFreeSockets: 1 },
        this.onConnect
      );
      // HttpsProxyAgent replaces `options`, so a `timeout` passed to the
      // constructor never reaches http.Agent, which reads it from there to
      // close idle sockets
      agent.options.timeout = this.idleTimeout;
      agent.protocol = "https:";
      this.agents.set(url, agent);
    }

    return agent;
  }

  // Socket names start with `<host>:<port>:`
  hasFreeSocket(url: string, host: string) {
    const freeSockets = this.agents.get(url)?.freeSockets ?? {};

    return Object.entries(freeSockets).some(
      ([name, sockets]) => name.startsWith(`${host}:`) && !!sockets?.length
    );
  }

  retain(urls: string[]) {
    const kept = new Set(urls);

    this.agents.forEach((agent, url) => {
      if (kept.has(url)) return;

      agent.destroy();
      this.agents.delete(url);
    });
  }

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
}
