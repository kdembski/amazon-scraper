import { ApiService } from "@/shared/backend/ApiService";
import { MetricsService } from "@/shared/metrics/MetricsService";
import { getRetryDelay, MAX_FAILED_ATTEMPTS } from "@/shared/utils/retry";
import { sleep } from "@/shared/utils/sleep";

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
  ) {}

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
    let failed = 0;
    while (true) {
      try {
        await this.apiService.send(this.path, this.toBody(items));
        this.metricsService.increment("backend_items", { outcome: "sent" }, items.length);
        return;
      } catch (e: any) {
        failed++;
        const status = e?.response?.status;
        if ((status && status < 500) || failed >= MAX_FAILED_ATTEMPTS) {
          console.error(`backend: ${items.length} items for ${this.path} dropped`, status ?? e?.message);
          this.metricsService.increment("backend_items", { outcome: "dropped" }, items.length);
          return;
        }
        await sleep(getRetryDelay(failed));
      }
    }
  }
}
