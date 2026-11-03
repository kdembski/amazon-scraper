import type http from "node:http";
import type net from "node:net";
import { MeteredAgent } from "@/shared/http/proxy/MeteredAgent";
import { MeteredProxyAgent } from "@/shared/http/proxy/MeteredProxyAgent";

export class ProxyAgentPool {
  private agents = new Map<string, MeteredProxyAgent>();
  private direct?: MeteredAgent;
  // Per host, proxies in the order their idle connection was last freed
  private freed = new Map<string, Set<string>>();
  // "<proxy> <host>" pairs blocked by the host, until the given time
  private blocked = new Map<string, number>();
  private idleTimeout = 15 * 1000;
  private blockTime = 5 * 60 * 1000;

  constructor(private onConnect: (socket: net.Socket) => void) {}

  get(url: string) {
    let agent = this.agents.get(url);

    if (!agent) {
      agent = new MeteredProxyAgent(
        url,
        { keepAlive: true, maxFreeSockets: 1 },
        this.onConnect
      );
      agent.options.timeout = this.idleTimeout;
      agent.protocol = "https:";
      agent.on("free", (socket: net.Socket, options: { host: string }) => {
        if (this.isBlocked(url, options.host)) {
          socket.destroy();
          return;
        }
        this.markFree(url, options.host);
      });
      this.agents.set(url, agent);
    }

    return agent;
  }

  getDirect() {
    this.direct ??= new MeteredAgent(
      { keepAlive: true, timeout: this.idleTimeout },
      this.onConnect
    );

    return this.direct;
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

  // Closes the proxy's idle connections to the host after a block (503,
  // captcha) and keeps the proxy away from the host for a while
  block(agent: http.Agent, host: string) {
    const url = [...this.agents].find(([, proxyAgent]) => proxyAgent === agent)?.[0];
    if (!url) return;

    this.blocked.set(`${url} ${host}`, Date.now() + this.blockTime);
    this.freed.get(host)?.delete(url);
    Object.entries(agent.freeSockets).forEach(([name, sockets]) => {
      if (name.startsWith(`${host}:`)) sockets?.forEach((socket) => socket.destroy());
    });
  }

  isBlocked(url: string, host: string) {
    const key = `${url} ${host}`;
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

    [...this.agents.values(), ...(this.direct ? [this.direct] : [])].forEach((agent) => {
      [agent.sockets, agent.freeSockets].forEach((pool) => {
        Object.values(pool).forEach((sockets) => {
          count += sockets?.length ?? 0;
        });
      });
    });

    return count;
  }
}
