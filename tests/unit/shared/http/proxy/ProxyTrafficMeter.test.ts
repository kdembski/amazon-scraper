import { EventEmitter } from "node:events";
import type net from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { Route } from "@/shared/http/http.types";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import type { MetricsService } from "@/shared/metrics/MetricsService";

type FakeSocket = EventEmitter & { bytesRead: number; bytesWritten: number };

const de = "www.amazon.de";

const fakeSocket = (bytesRead: number, bytesWritten: number): FakeSocket =>
  Object.assign(new EventEmitter(), { bytesRead, bytesWritten });

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

    track(fakeSocket(0, 0));
    track(fakeSocket(0, 0), de, "direct6");

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith("connections", { country: "de", outcome: "proxy" });
    expect(increment).toHaveBeenCalledWith("connections", { country: "de", outcome: "direct6" });
  });

  it("leaves out the country of a host without one", () => {
    const { meter, increment, track } = setup();

    track(fakeSocket(7, 1), "example.com");

    expect(increment).toHaveBeenCalledWith("connections", { country: undefined, outcome: "proxy" });
    expect(meter.collect()).toEqual([
      { labels: { country: undefined, outcome: "proxy" }, bytesIn: 7, bytesOut: 1 },
    ]);
  });

  it("reports the growth since the previous call", () => {
    const { meter, track } = setup();
    const socket = fakeSocket(100, 10);
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
    track(fakeSocket(100, 10));
    track(fakeSocket(50, 5));
    track(fakeSocket(20, 2), de, "direct4");
    track(fakeSocket(30, 3), "www.amazon.fr");

    expect(meter.collect()).toEqual([
      traffic(150, 15),
      traffic(20, 2, "direct4"),
      traffic(30, 3, "proxy", "fr"),
    ]);
  });

  it("counts a closed socket's last bytes at the next call and releases it on close", () => {
    const { meter, track } = setup();
    const socket = fakeSocket(100, 10);
    track(socket);
    meter.collect();

    socket.bytesRead = 130;
    socket.emit("close");
    expect(meter["sockets"].size).toBe(0);

    socket.bytesRead = 500;
    expect(meter.collect()).toEqual([traffic(30, 0)]);
    expect(meter.collect()).toEqual([]);
  });

  it("sums closed and open sockets of the same country and route", () => {
    const { meter, track } = setup();
    const closed = fakeSocket(100, 10);
    track(closed);
    track(fakeSocket(50, 5));

    closed.emit("close");

    expect(meter.collect()).toEqual([traffic(150, 15)]);
  });
});
