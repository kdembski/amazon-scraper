import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsReporter } from "@/shared/backend/MetricsReporter";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { ScrapingClient } from "@/shared/http/ScrapingClient";
import type { ProxyService } from "@/shared/http/ProxyService";
import { cronJobs } from "@@tests/support/cron";
import { fakeApiService } from "@@tests/support/fakes";
import { resetSingleton } from "@@tests/support/singleton";

vi.mock("cron", async () => (await import("@@tests/support/cron")).cronModule);

const gauges = [
  { metric: "pending", value: 12 },
  { metric: "queue_length", value: 3 },
  { metric: "open_connections", value: 5 },
];

const setup = ({ isPdp = true, traffic = { bytesIn: 0, bytesOut: 0 } } = {}) => {
  const args = {
    getTargetFlag: vi.fn(() => ({ isPdp, isPlp: !isPdp })),
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

  // The constructor is private, it is only called through getInstance()
  const Reporter = MetricsReporter as unknown as new (
    ...deps: unknown[]
  ) => MetricsReporter;
  const reporter = new Reporter(args, api.service, metrics, client, proxy, now);

  return { api, metrics, reporter, proxy };
};

describe("MetricsReporter", () => {
  beforeEach(() => {
    vi.stubEnv("name", "amazon-pdp");
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

  it.each([true, false])("starts a cron every minute (pdp: %s)", (isPdp) => {
    const { reporter } = setup({ isPdp });

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
      { timeout: 30000 }
    );
  });

  it("sends the PLP flow", async () => {
    const { api, metrics, reporter } = setup({ isPdp: false });
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

  it("restores the counters and keeps the period start after a failed send", async () => {
    const { api, metrics, reporter } = setup();
    api.post.mockResolvedValueOnce(undefined);
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    reporter.start("amazon");

    await reporter.send();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);
    await reporter.send();

    const second = api.post.mock.calls[1][1];
    expect(second.periodStart).toBe("2026-10-18T10:00:00.000Z");
    expect(second.metrics[0]).toEqual({
      metric: "requests",
      country: "de",
      outcome: "ok",
      value: 5,
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
