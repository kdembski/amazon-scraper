import type net from "node:net";
import { MetricsService } from "@/shared/metrics/MetricsService";

export class ProxyTrafficMeter {
  private sockets = new Map<net.Socket, { read: number; written: number }>();

  constructor(private metricsService = MetricsService.getInstance()) {}

  track(socket: net.Socket) {
    this.sockets.set(socket, { read: 0, written: 0 });
    this.metricsService.increment("connections");
  }

  collect() {
    let bytesIn = 0;
    let bytesOut = 0;

    this.sockets.forEach((seen, socket) => {
      bytesIn += socket.bytesRead - seen.read;
      bytesOut += socket.bytesWritten - seen.written;
      seen.read = socket.bytesRead;
      seen.written = socket.bytesWritten;
      if (socket.destroyed) this.sockets.delete(socket);
    });

    return { bytesIn, bytesOut };
  }
}
