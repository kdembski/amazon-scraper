import type http from "node:http";
import type net from "node:net";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";
import { FreeProxyTracker } from "@/shared/http/proxy/FreeProxyTracker";
import { MeteredAgent } from "@/shared/http/proxy/MeteredAgent";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";
import type { Route } from "@/shared/http/http.types";

export class ProxyAgentPool {
  private agents = new Map<string, MeteredProxyAgent>();
  // Direct agents per IP family, keyed "direct4" / "direct6"
  private directs = new Map<Route, MeteredAgent>();
  private idleTimeout = 15 * 1000;

  constructor(
    private onConnect: (socket: net.Socket, host: string, route: Route) => void,
    private blockList = new DirectBlockList(),
    private freeProxies = new FreeProxyTracker()
  ) {}

  get(url: string) {
    let agent = this.agents.get(url);

    if (!agent) {
      agent = new MeteredProxyAgent(
        url,
        { keepAlive: true, maxFreeSockets: 1 },
        (socket, host) => this.onConnect(socket, host, "proxy")
      );
      agent.options.timeout = this.idleTimeout;
      agent.protocol = "https:";
      agent.on("free", (_socket, options: { host: string }) => {
        this.freeProxies.markFree(url, options.host);
      });
      this.agents.set(url, agent);
    }

    return agent;
  }

  getDirect(family: 4 | 6) {
    const key = this.getDirectKey(family);
    let agent = this.directs.get(key);

    if (!agent) {
      agent = new MeteredAgent(
        { keepAlive: true, timeout: this.idleTimeout, family },
        (socket, host) => this.onConnect(socket, host, key)
      );
      agent.on("free", (socket: net.Socket, options: { host: string }) => {
        if (this.blockList.isBlocked(key, options.host)) socket.destroy();
      });
      this.directs.set(key, agent);
    }

    return agent;
  }

  isDirectBlocked(family: 4 | 6, host: string) {
    return this.blockList.isBlocked(this.getDirectKey(family), host);
  }

  private getDirectKey(family: 4 | 6) {
    return `direct${family}` as const;
  }

  getRoute(agent: http.Agent): Route {
    return this.findDirectKey(agent) ?? "proxy";
  }

  private findDirectKey(agent: http.Agent) {
    return [...this.directs].find(([, known]) => known === agent)?.[0];
  }

  hasFreeSocket(url: string, host: string) {
    const freeSockets = this.agents.get(url)?.freeSockets ?? {};

    return Object.entries(freeSockets).some(
      ([name, sockets]) => name.startsWith(`${host}:`) && !!sockets?.length
    );
  }

  takeLastFree(host: string, accept: (url: string) => boolean) {
    return this.freeProxies.takeLast(host, (url) => this.hasFreeSocket(url, host), accept);
  }

  // Closes the direct agent's idle connections to the host after a 403 or
  // 429 and keeps it away from the host for a while; proxy agents are left alone
  block(agent: http.Agent, host: string) {
    const key = this.findDirectKey(agent);
    if (!key) return;

    this.blockList.block(key, host);
    Object.entries(agent.freeSockets).forEach(([name, sockets]) => {
      if (name.startsWith(`${host}:`)) sockets?.forEach((socket) => socket.destroy());
    });
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

    [...this.agents.values(), ...this.directs.values()].forEach((agent) => {
      [agent.sockets, agent.freeSockets].forEach((pool) => {
        Object.values(pool).forEach((sockets) => {
          count += sockets?.length ?? 0;
        });
      });
    });

    return count;
  }
}
