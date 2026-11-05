import type net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "@/shared/http/http.types";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import type { MetricsService } from "@/shared/metrics/MetricsService";

type FakeSocket = { bytesRead: number; bytesWritten: number; destroyed: boolean };

const de = "www.amazon.de";

const setup = () => {
  const increment = vi.fn();
  const meter = new ProxyTrafficMeter({ increment } as unknown as MetricsService);
  meter.setCountry(de, "de");
  const track = (socket: FakeSocket, host = de, route: Route = "proxy") =>
    meter.track(socket as unknown as net.Socket, host, route);
  return { meter, increment, track };
};

const traffic = (bytesIn: number, bytesOut: number, outcome: Route = "proxy", country = "de") => ({
  labels: { country, outcome },
  bytesIn,
  bytesOut,
});

describe("ProxyTrafficMeter", () => {
  it("counts a connection for every tracked socket with its country and route", () => {
    const { increment, track } = setup();

    track({ bytesRead: 0, bytesWritten: 0, destroyed: false });
    track({ bytesRead: 0, bytesWritten: 0, destroyed: false }, de, "direct6");

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith("connections", { country: "de", outcome: "proxy" });
    expect(increment).toHaveBeenCalledWith("connections", { country: "de", outcome: "direct6" });
  });

  it("leaves out the country of a host without one", () => {
    const { meter, increment, track } = setup();

    track({ bytesRead: 7, bytesWritten: 1, destroyed: false }, "example.com");

    expect(increment).toHaveBeenCalledWith("connections", { country: undefined, outcome: "proxy" });
    expect(meter.collect()).toEqual([
      { labels: { country: undefined, outcome: "proxy" }, bytesIn: 7, bytesOut: 1 },
    ]);
  });

  it("reports the growth since the previous call", () => {
    const { meter, track } = setup();
    const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
    track(socket);

    expect(meter.collect()).toEqual([traffic(100, 10)]);

    socket.bytesRead = 250;
    socket.bytesWritten = 40;
    expect(meter.collect()).toEqual([traffic(150, 30)]);
    expect(meter.collect()).toEqual([traffic(0, 0)]);
  });

  it("sums sockets per country and route", () => {
    const { meter, track } = setup();
    meter.setCountry("www.amazon.fr", "fr");
    track({ bytesRead: 100, bytesWritten: 10, destroyed: false });
    track({ bytesRead: 50, bytesWritten: 5, destroyed: false });
    track({ bytesRead: 20, bytesWritten: 2, destroyed: false }, de, "direct4");
    track({ bytesRead: 30, bytesWritten: 3, destroyed: false }, "www.amazon.fr");

    expect(meter.collect()).toEqual([
      traffic(150, 15),
      traffic(20, 2, "direct4"),
      traffic(30, 3, "proxy", "fr"),
    ]);
  });

  it("counts a destroyed socket one last time and stops tracking it", () => {
    const { meter, track } = setup();
    const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
    track(socket);
    meter.collect();

    socket.bytesRead = 130;
    socket.destroyed = true;
    expect(meter.collect()).toEqual([traffic(30, 0)]);

    socket.bytesRead = 500;
    expect(meter.collect()).toEqual([]);
  });
});
