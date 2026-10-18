import type { MetricLabels, MetricRow } from "@/shared/metrics/metrics.types";

export class MetricsService {
  private static instance: MetricsService;
  private counters = new Map<string, MetricRow>();

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

  drain(): MetricRow[] {
    const rows = [...this.counters.values()];
    this.counters.clear();
    return rows;
  }

  restore(rows: MetricRow[]) {
    rows.forEach((row) => this.add(row));
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
