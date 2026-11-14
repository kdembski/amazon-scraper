import type net from "node:net";
import _ from "lodash";
import { FingerprintGenerator } from "@/shared/http/FingerprintGenerator";
import { DirectBlockList } from "@/shared/http/proxy/DirectBlockList";
import { FreeProxyTracker } from "@/shared/http/proxy/FreeProxyTracker";
import { Http2Endpoint } from "@/shared/http/proxy/Http2Endpoint";
import { ShopConnector } from "@/shared/http/proxy/ShopConnector";
import type { Route } from "@/shared/http/http.types";

const PROXY_MAX_STREAMS = 1;
const PROXY_WINDOW_SIZE = 64 * 1024;
const DIRECT_MAX_STREAMS = 100;

export class Http2SessionPool {
  private endpoints = new Map<string, Http2Endpoint>();
  private directs = new Map<Route, Http2Endpoint>();

  constructor(
    onConnect: (socket: net.Socket, host: string, route: Route) => void,
    private blockList = new DirectBlockList(),
    private freeProxies = new FreeProxyTracker(),
    private connector = new ShopConnector(onConnect)
  ) {}

  get(url: string) {
    let endpoint = this.endpoints.get(url);

    if (!endpoint) {
      endpoint = new Http2Endpoint(
        "proxy",
        (host, fingerprint, signal) =>
          this.connector.connect(host, "proxy", fingerprint, signal, url),
        PROXY_MAX_STREAMS,
        new FingerprintGenerator(Math.random, PROXY_WINDOW_SIZE)
      );
      endpoint.on("free", (host: string) => this.freeProxies.markFree(url, host));
      this.endpoints.set(url, endpoint);
    }

    return endpoint;
  }

  getDirect(family: 4 | 6) {
    const key = this.getDirectKey(family);
    let endpoint = this.directs.get(key);

    if (!endpoint) {
      const created = new Http2Endpoint(
        key,
        (host, fingerprint, signal) =>
          this.connector.connect(host, key, fingerprint, signal),
        DIRECT_MAX_STREAMS
      );
      created.on("free", (host: string) => {
        if (this.blockList.isBlocked(key, host)) created.closeIdle(host);
      });
      this.directs.set(key, created);
      endpoint = created;
    }

    return endpoint;
  }

  isDirectBlocked(family: 4 | 6, host: string) {
    return this.blockList.isBlocked(this.getDirectKey(family), host);
  }

  private getDirectKey(family: 4 | 6) {
    return `direct${family}` as const;
  }

  getRoute(endpoint: Http2Endpoint) {
    return endpoint.route;
  }

  takeLastFree(host: string, accept: (url: string) => boolean) {
    return this.freeProxies.takeLast(
      host,
      (url) => !!this.endpoints.get(url)?.hasIdle(host),
      accept
    );
  }

  report(endpoint: Http2Endpoint, host: string, blocked: boolean) {
    if (endpoint.route === "proxy") return;
    if (!this.blockList.record(endpoint.route, host, blocked)) return;

    endpoint.closeIdle(host);
  }

  retain(urls: string[]) {
    const kept = new Set(urls);

    this.endpoints.forEach((endpoint, url) => {
      if (kept.has(url)) return;

      endpoint.destroy();
      this.endpoints.delete(url);
    });
  }

  countConnections() {
    return _.sumBy([...this.endpoints.values(), ...this.directs.values()], (endpoint) =>
      endpoint.countSessions()
    );
  }
}
