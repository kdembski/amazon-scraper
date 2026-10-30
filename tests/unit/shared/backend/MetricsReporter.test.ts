import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { ScrapingClient } from "@/shared/http/ScrapingClient";
import type { ProxyService } from "@/shared/http/proxy/ProxyService";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const gauges = [
  { metric: "pending", value: 12 },
  { metric: "queue_length", value: 3 },
  { metric: "open_connections", value: 5 },
  { metric: "event_loop_delay_mean_ms", value: 2.5 },
  { metric: "event_loop_delay_max_ms", value: 40 },
  { metric: "cpu_percent", value: 8.3 },
  { metric: "memory_rss_mb", value: 150 },
  { metric: "heap_used_mb", value: 90 },
  { metric: "ping_ms", value: 24.5 },
];

const setup = ({ target = "pdp", traffic = { bytesIn: 0, bytesOut: 0 } } = {}) => {
  const args = {
    getTargetFlag: vi.fn(() => target),
    getScraperName: vi.fn(async () => "amazon-pdp"),
  } as unknown as ArgsService;
  const api = fakeApiService();
  api.post.mockResolvedValue({ status: 200 });
  const metrics = MetricsService.getInstance();
  const client = {
    queueService: { pending: 12, queue: [() => 1, () => 2, () => 3] },
  } as unknown as ScrapingClient;
  const proxy = {
    collectTraffic: vi.fn(() => traffic),
    countConnections: vi.fn(() => 5),
  } as unknown as ProxyService;
  const times = [
    new Date("2026-10-18T10:00:00.000Z"),
    new Date("2026-10-18T10:01:00.000Z"),
    new Date("2026-10-18T10:02:00.000Z"),
    new Date("2026-10-18T10:03:00.000Z"),
  ];
  const now = vi.fn(() => times.shift()!);
  // Nanoseconds, including the 10 ms sampling interval
  const eventLoopDelay = {
    enable: vi.fn(),
    reset: vi.fn(),
    mean: 12_500_000,
    max: 50_000_000,
  };
  // Microseconds: 5 s of CPU between start() and the first send(), 60 s apart
  const cpuUsage = vi
    .fn()
    .mockReturnValueOnce({ user: 1_000_000, system: 0 })
    .mockReturnValue({ user: 4_000_000, system: 2_000_000 });
  const memoryRss = vi.fn(() => 150 * 1024 * 1024);
  const heapUsed = vi.fn(() => 90 * 1024 * 1024);
  const ping = vi.fn(async (): Promise<number | undefined> => 24.5);

  // The constructor is private, it is only called through getInstance()
  const Reporter = MetricsReporter as unknown as new (
    ...deps: unknown[]
  ) => MetricsReporter;
  const reporter = new Reporter(
    args,
    api.service,
    metrics,
    client,
    proxy,
    now,
    eventLoopDelay,
    cpuUsage,
    memoryRss,
    heapUsed,
    ping
  );

  return { api, metrics, reporter, proxy, eventLoopDelay, ping };
};

describe("MetricsReporter", () => {
  beforeEach(() => {
    cronJobs.length = 0;
    resetSingleton(MetricsService);
  });

  it("is a singleton", () => {
    const Reporter = MetricsReporter as unknown as { instance?: unknown };
    const instance = {};
    Reporter.instance = instance;
    expect(MetricsReporter.getInstance()).toBe(instance);
    resetSingleton(MetricsReporter);
  });

  it.each(["pdp", "plp"])("starts a cron every minute (%s)", (target) => {
    const { reporter } = setup({ target });

    reporter.start("amazon");

    expect(cronJobs).toHaveLength(1);
    expect(cronJobs[0].cronTime).toBe("0 * * * * *");
    expect(cronJobs[0].start).toHaveBeenCalled();
  });

  it("sends counters and gauges", async () => {
    const { api, metrics, reporter } = setup();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 4);
    reporter.start("amazon");

    await reporter.send();

    expect(api.post).toHaveBeenCalledWith(
      "scrapers/amazon-pdp/metrics",
      {
        marketplace: "amazon",
        flow: "pdp",
        periodStart: "2026-10-18T10:00:00.000Z",
        metrics: [
          { metric: "requests", country: "de", outcome: "ok", value: 4 },
          ...gauges,
        ],
      },
      { timeout: 30000, headers: { "Idempotency-Key": expect.any(String) } }
    );
  });

  it("adds the registered gauges read at sending", async () => {
    const { api, metrics, reporter } = setup();
    let inFlight = 1;
    metrics.gauge("ads_in_flight", () => inFlight);
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");
    inFlight = 7;

    await reporter.send();

    expect(api.post.mock.calls[0][1].metrics.at(-1)).toEqual({ metric: "ads_in_flight", value: 7 });
  });

  it("measures the event loop delay from the start and resets it after each send", async () => {
    const { metrics, reporter, eventLoopDelay } = setup();
    reporter.start("amazon");
    expect(eventLoopDelay.enable).toHaveBeenCalled();

    await reporter.send();
    expect(eventLoopDelay.reset).not.toHaveBeenCalled();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();
    expect(eventLoopDelay.reset).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Number.NaN, 0],
    [9_000_000, 0],
    [10_040_000, 0],
    [10_060_000, 0.1],
  ])("reports an event loop delay of %d ns as %d ms", async (delay, expected) => {
    const { api, metrics, reporter, eventLoopDelay } = setup();
    eventLoopDelay.mean = delay;
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");

    await reporter.send();

    expect(api.post.mock.calls[0][1].metrics).toContainEqual({
      metric: "event_loop_delay_mean_ms",
      value: expected,
    });
  });

  it("reports a failed ping instead of its time", async () => {
    const { api, metrics, reporter, ping } = setup();
    ping.mockResolvedValue(undefined);
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");

    await reporter.send();

    const sent = api.post.mock.calls[0][1].metrics;
    expect(sent).toContainEqual({ metric: "ping_failed", value: 1 });
    expect(sent).not.toContainEqual(expect.objectContaining({ metric: "ping_ms" }));
  });

  it("measures the CPU since the previous send", async () => {
    const { api, metrics, reporter } = setup();
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");
    await reporter.send();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();

    expect(api.post.mock.calls[1][1].metrics).toContainEqual({
      metric: "cpu_percent",
      value: 0,
    });
  });

  it("sends the PLP flow", async () => {
    const { api, metrics, reporter } = setup({ target: "plp" });
    metrics.increment("requests", { country: "pl", outcome: "ok" });
    reporter.start("amazon");

    await reporter.send();

    expect(api.post.mock.calls[0][1].flow).toBe("plp");
  });

  it("adds the traffic that is above zero", async () => {
    const { api, reporter } = setup({ traffic: { bytesIn: 100, bytesOut: 0 } });
    reporter.start("amazon");

    await reporter.send();

    expect(api.post.mock.calls[0][1].metrics).toEqual([
      { metric: "bytes_in", value: 100 },
      ...gauges,
    ]);
  });

  it("sends nothing without counters", async () => {
    const { api, reporter } = setup();
    reporter.start("amazon");

    await reporter.send();

    expect(api.post).not.toHaveBeenCalled();
  });

  it("keeps the period start when there is nothing to send", async () => {
    const { api, metrics, reporter } = setup();
    reporter.start("amazon");
    await reporter.send();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();

    expect(api.post.mock.calls[0][1].periodStart).toBe("2026-10-18T10:00:00.000Z");
  });

  it("resends a failed report unchanged with its key before the next one", async () => {
    const { api, metrics, reporter } = setup();
    api.post.mockResolvedValueOnce(undefined);
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();

    const [failed, retry, next] = api.post.mock.calls;
    expect(retry[1]).toBe(failed[1]);
    expect(retry[2]).toEqual(failed[2]);
    expect(next[2].headers["Idempotency-Key"]).not.toBe(failed[2].headers["Idempotency-Key"]);
    expect(next[1].periodStart).toBe("2026-10-18T10:01:00.000Z");
    expect(next[1].metrics[0]).toEqual({
      metric: "requests",
      country: "de",
      outcome: "ok",
      value: 3,
    });
  });

  it("keeps collecting while a failed report still does not go through", async () => {
    const { api, metrics, reporter } = setup();
    api.post.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 4);
    await reporter.send();

    const calls = api.post.mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[2][1]).toBe(calls[0][1]);
    expect(calls[3][1].metrics[0]).toEqual({
      metric: "requests",
      country: "de",
      outcome: "ok",
      value: 7,
    });
  });

  it("moves the period start to the previous send after a successful one", async () => {
    const { api, metrics, reporter } = setup();
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");
    await reporter.send();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();

    expect(api.post.mock.calls[1][1].periodStart).toBe("2026-10-18T10:01:00.000Z");
  });
});
