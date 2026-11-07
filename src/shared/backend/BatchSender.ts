import { randomUUID } from "crypto";
import { ApiService } from "@/shared/backend/ApiService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import type { RequestOutcome } from "@/shared/metrics/metrics.types";
import { toRequestOutcome } from "@/shared/metrics/toRequestOutcome";
import { RetryBackoff } from "@/shared/utils/RetryBackoff";

// Buffers items for one backend path and posts them together
export class BatchSender<T> {
  private buffer: T[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private flushing = false;

  constructor(
    private path: string,
    private toBody: (items: T[]) => unknown,
    private maxSize: number,
    private flushInterval = 5000,
    private apiService = ApiService.getInstance(),
    private metricsService = MetricsService.getInstance()
  ) {
    metricsService.gauge("backend_buffer", () => this.buffer.length);
  }

  add(item: T) {
    this.buffer.push(item);
    if (this.buffer.length >= this.maxSize) {
      this.flush();
      return;
    }
    this.arm();
  }

  private arm() {
    if (this.timer || this.flushing) return;
    this.timer = setTimeout(() => this.flush(), this.flushInterval);
  }

  private async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.flushing || !this.buffer.length) return;

    this.flushing = true;
    const items = this.buffer.splice(0, this.maxSize);
    await this.send(items);
    this.flushing = false;

    if (this.buffer.length >= this.maxSize) {
      this.flush();
      return;
    }
    if (this.buffer.length) this.arm();
  }

  private async send(items: T[]) {
    const key = randomUUID();
    const retry = new RetryBackoff();

    while (true) {
      const startedAt = Date.now();

      try {
        await this.apiService.send(this.path, this.toBody(items), key);

        this.countRequest("ok", startedAt);
        this.metricsService.increment("backend_items", { outcome: "sent" }, items.length);
        return;
      } catch (e: any) {
        this.countRequest(toRequestOutcome(e), startedAt);
        retry.fail();

        const status = e?.response?.status;
        if ((status && status < 500) || retry.isExhausted) {
          console.error(`backend: ${items.length} items for ${this.path} dropped`, status ?? e?.message);
          this.metricsService.increment("backend_items", { outcome: "dropped" }, items.length);
          return;
        }

        await retry.wait();
      }
    }
  }

  private countRequest(outcome: RequestOutcome, startedAt: number) {
    this.metricsService.increment("backend_requests", { outcome });
    this.metricsService.increment("backend_send_ms", {}, Date.now() - startedAt);
  }
}
