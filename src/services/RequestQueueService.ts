import os from "os";
import { calculateAvg, roundToTwoDecimals } from "@/helpers/number";
import { RequestQueueRegulator } from "@/services/RequestQueueRegulator";

export class RequestQueueService {
  private regulator: RequestQueueRegulator;
  private completedHistory: number[] = [];
  previousCompleted = 0;
  queue: (() => any)[] = [];
  speed = 0;
  completed = 0;
  failed = 0;
  pending = 0;
  limit;
  // Max requests started per second, 0 means unlimited
  rate;
  private tokens;
  private lastRefill = Date.now();

  constructor(
    limit: number,
    rate = 0,
    enableLogs = false,
    enableRegulation = false,
    regulator = new RequestQueueRegulator(this)
  ) {
    this.limit = limit;
    this.rate = rate;
    this.tokens = rate;
    this.regulator = regulator;

    setInterval(() => {
      this.updateCompletedHistory();
    }, 1000);

    if (enableLogs) {
      setInterval(() => this.logState(), 1000);
    }

    if (enableRegulation) {
      regulator.start();
    }
  }

  start() {
    setTimeout(() => {
      for (let i = 0; i < 10; i++) {
        this.next();
      }
      this.start();
    }, 1);
  }

  async request(callback: () => Promise<void>, top?: boolean) {
    if (!this.canStart()) {
      this.add(callback, top);
      return;
    }

    return this.run(callback);
  }

  private add(callback: () => any, top?: boolean) {
    if (top) {
      this.queue.unshift(callback);
      return;
    }

    this.queue.push(callback);
  }

  private async next() {
    if (!this.queue.length || !this.canStart()) return;
    const next = this.queue.shift()!;

    // Nobody awaits a queued request, so its error would be unhandled
    await this.run(next).catch((e) => console.error(e));
  }

  private async run(callback: () => any) {
    if (this.rate) this.tokens--;

    this.pending++;
    try {
      return await callback();
    } finally {
      this.pending--;
    }
  }

  private canStart() {
    if (this.pending >= this.limit) return false;
    if (!this.rate) return true;

    this.refillTokens();
    return this.tokens >= 1;
  }

  // Token bucket holding at most one second worth of requests
  private refillTokens() {
    const now = Date.now();
    const refill = ((now - this.lastRefill) * this.rate) / 1000;

    this.tokens = Math.min(this.rate, this.tokens + refill);
    this.lastRefill = now;
  }

  private updateCompletedHistory() {
    let diff = this.completed - this.previousCompleted;
    diff = diff < 0 ? 0 : diff;

    const length = this.completedHistory.unshift(diff);
    this.completedHistory.length = Math.min(length, 24 * 60 * 60);

    this.previousCompleted = this.completed;
    this.calculateSpeed();
  }

  private calculateSpeed() {
    if (!this.completedHistory.length) return;
    this.speed = calculateAvg(this.completedHistory);
  }

  private logState() {
    const stats = [
      `speed: ${roundToTwoDecimals(this.speed)}/s`,
      `tcpu: ${this.getTargetedCpu()}%`,
      `limit: ${this.limit}`,
      `rate: ${this.rate || "-"}/s`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }

  private getTargetedCpu() {
    const scrapersCount = this.regulator.scrapersCount;
    const targetedGlobalCpu = this.regulator.targetedGlobalCpu;
    const cpusCount = os.cpus().length;

    if (!scrapersCount) return "-";
    return Math.round((cpusCount * targetedGlobalCpu) / scrapersCount);
  }
}
