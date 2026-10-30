import type { MetricLabels, MetricRow } from "@/shared/metrics/metrics.types";

export class MetricsService {
  private static instance: MetricsService;
  private counters = new Map<string, MetricRow>();
  private gauges = new Map<string, () => number>();

  private constructor() {}

  static getInstance() {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  increment(metric: string, labels: MetricLabels = {}, value = 1) {
    this.add({ metric, ...labels, value });
  }

  // Read at every report; registering a metric again replaces its reader
  gauge(metric: string, read: () => number) {
    this.gauges.set(metric, read);
  }

  readGauges(): MetricRow[] {
    return [...this.gauges].map(([metric, read]) => ({ metric, value: read() }));
  }

  drain(): MetricRow[] {
    const rows = [...this.counters.values()];
    this.counters.clear();
    return rows;
  }

  private add({ metric, country, outcome, value }: MetricRow) {
    const key = JSON.stringify([metric, country, outcome]);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
      return;
    }
    const row: MetricRow = { metric, value };
    if (country !== undefined) row.country = country;
    if (outcome !== undefined) row.outcome = outcome;
    this.counters.set(key, row);
  }
}
