import type http from "node:http";
import type net from "node:net";
import { MeteredAgent } from "@/shared/http/proxy/MeteredAgent";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";
import type { Route } from "@/shared/http/http.types";

export class ProxyAgentPool {
  private agents = new Map<string, MeteredProxyAgent>();
  // Direct agents per IP family, keyed "direct4" / "direct6"
  private directs = new Map<Route, MeteredAgent>();
  // Per host, proxies in the order their idle connection was last freed
  private freed = new Map<string, Set<string>>();
  // "<direct key> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();
  private idleTimeout = 15 * 1000;
  private blockTime = 10 * 60 * 1000;

  constructor(
    private onConnect: (socket: net.Socket, host: string, route: Route) => void
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
        this.markFree(url, options.host);
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
        if (this.isBlocked(key, options.host)) socket.destroy();
      });
      this.directs.set(key, agent);
    }

    return agent;
  }

  isDirectBlocked(family: 4 | 6, host: string) {
    return this.isBlocked(this.getDirectKey(family), host);
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

  // Proxy with the most recently freed idle connection to the host, removed
  // from the order so the next caller gets another one
  takeLastFree(host: string, accept: (url: string) => boolean) {
    const urls = this.freed.get(host);
    if (!urls) return;

    for (const url of [...urls].reverse()) {
      if (!this.hasFreeSocket(url, host)) {
        urls.delete(url);
        continue;
      }
      if (!accept(url)) continue;

      urls.delete(url);
      return url;
    }
  }

  // Closes the direct agent's idle connections to the host after a 403 or
  // 429 and keeps it away from the host for a while; proxy agents are left alone
  block(agent: http.Agent, host: string) {
    const key = this.findDirectKey(agent);
    if (!key) return;

    this.blocked.set(`${key} ${host}`, Date.now() + this.blockTime);
    Object.entries(agent.freeSockets).forEach(([name, sockets]) => {
      if (name.startsWith(`${host}:`)) sockets?.forEach((socket) => socket.destroy());
    });
  }

  private isBlocked(directKey: string, host: string) {
    const key = `${directKey} ${host}`;
    const until = this.blocked.get(key);
    if (!until) return false;
    if (until > Date.now()) return true;

    this.blocked.delete(key);
    return false;
  }

  private markFree(url: string, host: string) {
    const urls = this.freed.get(host) ?? new Set<string>();
    urls.delete(url);
    urls.add(url);
    this.freed.set(host, urls);
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
