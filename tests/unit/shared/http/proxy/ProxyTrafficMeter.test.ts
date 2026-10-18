import type net from "node:net";
import { describe, expect, it, vi } from "vitest";
import { ProxyTrafficMeter } from "@/shared/http/proxy/ProxyTrafficMeter";
import type { MetricsService } from "@/shared/metrics/MetricsService";

type FakeSocket = { bytesRead: number; bytesWritten: number; destroyed: boolean };

const setup = () => {
  const increment = vi.fn();
  const meter = new ProxyTrafficMeter({ increment } as unknown as MetricsService);
  const track = (socket: FakeSocket) => meter.track(socket as unknown as net.Socket);
  return { meter, increment, track };
};

describe("ProxyTrafficMeter", () => {
  it("counts a tunnel for every tracked socket", () => {
    const { increment, track } = setup();

    track({ bytesRead: 0, bytesWritten: 0, destroyed: false });
    track({ bytesRead: 0, bytesWritten: 0, destroyed: false });

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith("connections");
  });

  it("reports the growth since the previous call", () => {
    const { meter, track } = setup();
    const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
    track(socket);

    expect(meter.collect()).toEqual({ bytesIn: 100, bytesOut: 10 });

    socket.bytesRead = 250;
    socket.bytesWritten = 40;
    expect(meter.collect()).toEqual({ bytesIn: 150, bytesOut: 30 });
    expect(meter.collect()).toEqual({ bytesIn: 0, bytesOut: 0 });
  });

  it("sums all tracked sockets", () => {
    const { meter, track } = setup();
    track({ bytesRead: 100, bytesWritten: 10, destroyed: false });
    track({ bytesRead: 50, bytesWritten: 5, destroyed: false });

    expect(meter.collect()).toEqual({ bytesIn: 150, bytesOut: 15 });
  });

  it("counts a destroyed socket one last time and stops tracking it", () => {
    const { meter, track } = setup();
    const socket = { bytesRead: 100, bytesWritten: 10, destroyed: false };
    track(socket);
    meter.collect();

    socket.bytesRead = 130;
    socket.destroyed = true;
    expect(meter.collect()).toEqual({ bytesIn: 30, bytesOut: 0 });

    socket.bytesRead = 500;
    expect(meter.collect()).toEqual({ bytesIn: 0, bytesOut: 0 });
  });
});
