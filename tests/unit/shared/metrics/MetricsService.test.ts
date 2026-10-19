import { describe, expect, it } from "vitest";
import { MetricsService } from "@/shared/metrics/MetricsService";

describe("MetricsService", () => {
  const metrics = MetricsService.getInstance();

  it("is a singleton", () => {
    expect(MetricsService.getInstance()).toBe(metrics);
  });

  it("sums increments of the same series", () => {
    metrics.drain();
    metrics.increment("requests", { country: "de", outcome: "ok" });
    metrics.increment("requests", { country: "de", outcome: "ok" });
    metrics.increment("requests", { country: "de", outcome: "ok" }, 3);

    expect(metrics.drain()).toEqual([
      { metric: "requests", country: "de", outcome: "ok", value: 5 },
    ]);
  });

  it("keeps different labels as separate rows", () => {
    metrics.drain();
    metrics.increment("requests", { country: "de", outcome: "ok" });
    metrics.increment("requests", { country: "fr", outcome: "ok" });
    metrics.increment("requests", { country: "de", outcome: "timeout" });

    expect(metrics.drain()).toHaveLength(3);
  });

  it("omits label keys that are not set", () => {
    metrics.drain();
    metrics.increment("proxies");

    const [row] = metrics.drain();
    expect(row).toEqual({ metric: "proxies", value: 1 });
    expect(Object.keys(row)).toEqual(["metric", "value"]);
  });

  it("returns nothing on the second drain", () => {
    metrics.drain();
    metrics.increment("requests");
    metrics.drain();

    expect(metrics.drain()).toEqual([]);
  });

  it("adds restored rows to the current counters", () => {
    metrics.drain();
    metrics.increment("requests", { country: "de", outcome: "ok" }, 2);
    const rows = metrics.drain();

    metrics.restore(rows);
    metrics.increment("requests", { country: "de", outcome: "ok" });

    expect(metrics.drain()).toEqual([
      { metric: "requests", country: "de", outcome: "ok", value: 3 },
    ]);
  });
});
