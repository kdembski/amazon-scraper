import type net from "node:net";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { Route, Traffic } from "@/shared/http/http.types";

type TrackedSocket = { host: string; route: Route; read: number; written: number };

export class ProxyTrafficMeter {
  private sockets = new Map<net.Socket, TrackedSocket>();
  private closed = new Map<string, Traffic>();
  // Country of each shop host, from the labels of its requests
  private countries = new Map<string, string>();

  constructor(private metricsService = MetricsService.getInstance()) {}

  setCountry(host: string, country: string) {
    this.countries.set(host, country);
  }

  track(socket: net.Socket, host: string, route: Route) {
    const seen = { host, route, read: 0, written: 0 };
    this.sockets.set(socket, seen);
    socket.once("close", () => {
      this.add(this.closed, socket, seen);
      this.sockets.delete(socket);
    });
    this.metricsService.increment("connections", this.getLabels(host, route));
  }

  // Growth since the previous call per country and route
  collect(): Traffic[] {
    const traffic = this.closed;
    this.closed = new Map();

    this.sockets.forEach((seen, socket) => this.add(traffic, socket, seen));
    return [...traffic.values()];
  }

  private add(traffic: Map<string, Traffic>, socket: net.Socket, seen: TrackedSocket) {
    const labels = this.getLabels(seen.host, seen.route);
    const key = JSON.stringify([labels.country, labels.outcome]);
    const row = traffic.get(key) ?? { labels, bytesIn: 0, bytesOut: 0 };
    row.bytesIn += socket.bytesRead - seen.read;
    row.bytesOut += socket.bytesWritten - seen.written;
    traffic.set(key, row);

    seen.read = socket.bytesRead;
    seen.written = socket.bytesWritten;
  }

  private getLabels(host: string, route: Route) {
    return { country: this.countries.get(host), outcome: route };
  }
}
