import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsReporter } from "@/shared/metrics/MetricsReporter";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import type { ProxyService } from "@/shared/http/proxy/ProxyService";
import type { Traffic } from "@/shared/http/http.types";
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

const setup = ({ target = "pdp", traffic = [] as Traffic[] } = {}) => {
  const args = {
    getTargetFlag: vi.fn(() => target),
  } as unknown as ArgsService;
  const api = fakeApiService();
  api.send.mockResolvedValue({});
  const metrics = MetricsService.getInstance();
  const queue = { pending: 12, queue: [() => 1, () => 2, () => 3] } as unknown as TokenBucketQueue;
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
  const processMetrics = {
    start: vi.fn(),
    collect: vi.fn(async () => gauges.slice(3)),
  };

  // The constructor is private, it is only called through getInstance()
  const Reporter = MetricsReporter as unknown as new (
    ...deps: unknown[]
  ) => MetricsReporter;
  const reporter = new Reporter(
    args,
    api.service,
    metrics,
    queue,
    proxy,
    now,
    processMetrics,
    { get: async () => "amazon-pdp" }
  );

  return { api, metrics, reporter, proxy, processMetrics };
};

describe("MetricsReporter", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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

    expect(api.send).toHaveBeenCalledWith(
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
      expect.any(String)
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

    expect(api.send.mock.calls[0][1].metrics.at(-1)).toEqual({ metric: "ads_in_flight", value: 7 });
  });

  it("starts the process metrics with the period start and collects them only with counters", async () => {
    const { metrics, reporter, processMetrics } = setup();
    reporter.start("amazon");
    expect(processMetrics.start).toHaveBeenCalledWith(new Date("2026-10-18T10:00:00.000Z"));

    await reporter.send();
    expect(processMetrics.collect).not.toHaveBeenCalled();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();
    expect(processMetrics.collect).toHaveBeenCalledTimes(1);
  });

  it("sends the PLP flow", async () => {
    const { api, metrics, reporter } = setup({ target: "plp" });
    metrics.increment("requests", { country: "pl", outcome: "ok" });
    reporter.start("amazon");

    await reporter.send();

    expect(api.send.mock.calls[0][1].flow).toBe("plp");
  });

  it("adds the traffic that is above zero with its country and route", async () => {
    const { api, reporter } = setup({
      traffic: [
        { labels: { country: "de", outcome: "direct6" }, bytesIn: 100, bytesOut: 0 },
        { labels: { country: "fr", outcome: "proxy" }, bytesIn: 0, bytesOut: 20 },
      ],
    });
    reporter.start("amazon");

    await reporter.send();

    expect(api.send.mock.calls[0][1].metrics).toEqual([
      { metric: "bytes_in", country: "de", outcome: "direct6", value: 100 },
      { metric: "bytes_out", country: "fr", outcome: "proxy", value: 20 },
      ...gauges,
    ]);
  });

  it("sends nothing without counters", async () => {
    const { api, reporter } = setup();
    reporter.start("amazon");

    await reporter.send();

    expect(api.send).not.toHaveBeenCalled();
  });

  it("keeps the period start when there is nothing to send", async () => {
    const { api, metrics, reporter } = setup();
    reporter.start("amazon");
    await reporter.send();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();

    expect(api.send.mock.calls[0][1].periodStart).toBe("2026-10-18T10:00:00.000Z");
  });

  it("resends a failed report unchanged with its key before the next one", async () => {
    const { api, metrics, reporter } = setup();
    api.send.mockRejectedValueOnce({ status: 503, response: { status: 503 } });
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();

    const [failed, retry, next] = api.send.mock.calls;
    expect(retry[1]).toBe(failed[1]);
    expect(retry[2]).toEqual(failed[2]);
    expect(next[2]).not.toBe(failed[2]);
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
    api.send.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down"));
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 4);
    await reporter.send();

    const calls = api.send.mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[2][1]).toBe(calls[0][1]);
    expect(calls[3][1].metrics[0]).toEqual({
      metric: "requests",
      country: "de",
      outcome: "ok",
      value: 7,
    });
  });

  it("drops a report rejected with a 4xx and goes on with the next one", async () => {
    const { api, metrics, reporter } = setup();
    api.send.mockRejectedValueOnce({ status: 400, response: { status: 400 } });
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();

    const [rejected, next] = api.send.mock.calls;
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(next[1]).not.toBe(rejected[1]);
    expect(next[1].metrics[0].value).toBe(3);
  });

  it("moves the period start to the previous send after a successful one", async () => {
    const { api, metrics, reporter } = setup();
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");
    await reporter.send();

    metrics.increment("requests", { country: "de", outcome: "ok" });
    await reporter.send();

    expect(api.send.mock.calls[1][1].periodStart).toBe("2026-10-18T10:01:00.000Z");
  });

  it("resends a failed report even when there are no new counters", async () => {
    const { api, metrics, reporter } = setup();
    api.send.mockRejectedValueOnce(new Error("down"));
    metrics.increment("requests", { country: "de", outcome: "ok" });
    reporter.start("amazon");

    await reporter.send();
    await reporter.send();

    const [failed, retry] = api.send.mock.calls;
    expect(api.send).toHaveBeenCalledTimes(2);
    expect(retry[1]).toBe(failed[1]);
  });
});
