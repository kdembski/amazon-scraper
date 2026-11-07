import { describe, expect, it, vi } from "vitest";
import { ProcessMetrics } from "@/shared/metrics/ProcessMetrics";

const startedAt = new Date("2026-10-18T10:00:00.000Z");
const firstAt = new Date("2026-10-18T10:01:00.000Z");
const secondAt = new Date("2026-10-18T10:02:00.000Z");

const setup = () => {
  // Nanoseconds, including the 10 ms sampling interval
  const eventLoopDelay = {
    enable: vi.fn(),
    reset: vi.fn(),
    mean: 12_500_000,
    max: 50_000_000,
  };
  // Microseconds: 5 s of CPU between start() and the first collect(), 60 s apart
  const cpuUsage = vi
    .fn()
    .mockReturnValueOnce({ user: 1_000_000, system: 0 })
    .mockReturnValue({ user: 4_000_000, system: 2_000_000 });
  const ping = vi.fn(async (): Promise<number | undefined> => 24.5);
  const processMetrics = new ProcessMetrics(
    eventLoopDelay as never,
    cpuUsage,
    () => 150 * 1024 * 1024,
    () => 90 * 1024 * 1024,
    ping
  );

  return { processMetrics, eventLoopDelay, ping };
};

describe("ProcessMetrics", () => {
  it("collects the event loop, CPU, memory and ping", async () => {
    const { processMetrics } = setup();
    processMetrics.start(startedAt);

    await expect(processMetrics.collect(firstAt)).resolves.toEqual([
      { metric: "event_loop_delay_mean_ms", value: 2.5 },
      { metric: "event_loop_delay_max_ms", value: 40 },
      { metric: "cpu_percent", value: 8.3 },
      { metric: "memory_rss_mb", value: 150 },
      { metric: "heap_used_mb", value: 90 },
      { metric: "ping_ms", value: 24.5 },
    ]);
  });

  it("measures the event loop delay from the start and resets it after each collect", async () => {
    const { processMetrics, eventLoopDelay } = setup();

    processMetrics.start(startedAt);
    expect(eventLoopDelay.enable).toHaveBeenCalled();
    expect(eventLoopDelay.reset).not.toHaveBeenCalled();

    await processMetrics.collect(firstAt);
    expect(eventLoopDelay.reset).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Number.NaN, 0],
    [9_000_000, 0],
    [10_040_000, 0],
    [10_060_000, 0.1],
  ])("reports an event loop delay of %d ns as %d ms", async (delay, expected) => {
    const { processMetrics, eventLoopDelay } = setup();
    eventLoopDelay.mean = delay;
    processMetrics.start(startedAt);

    expect(await processMetrics.collect(firstAt)).toContainEqual({
      metric: "event_loop_delay_mean_ms",
      value: expected,
    });
  });

  it("reports a failed ping instead of its time", async () => {
    const { processMetrics, ping } = setup();
    ping.mockResolvedValue(undefined);
    processMetrics.start(startedAt);

    const rows = await processMetrics.collect(firstAt);

    expect(rows).toContainEqual({ metric: "ping_failed", value: 1 });
    expect(rows).not.toContainEqual(expect.objectContaining({ metric: "ping_ms" }));
  });

  it("measures the CPU since the previous collect", async () => {
    const { processMetrics } = setup();
    processMetrics.start(startedAt);
    await processMetrics.collect(firstAt);

    expect(await processMetrics.collect(secondAt)).toContainEqual({
      metric: "cpu_percent",
      value: 0,
    });
  });
});
