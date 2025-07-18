import os from "os";
import { calculateAvg, roundToTwoDecimals } from "@/helpers/number";
import { RequestQueueRegulator } from "@/services/RequestQueueRegulator";

export class RequestQueueService {
  private regulator: RequestQueueRegulator;
  private completedHistory: number[] = [];
  previousCompleted = 0;
  queue: Function[] = [];
  speed = 0;
  completed = 0;
  failed = 0;
  pending = 0;
  limit;

  constructor(
    limit: number,
    enableLogs = false,
    enableRegulation = false,
    regulator = new RequestQueueRegulator(this)
  ) {
    this.limit = limit;
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
    if (this.pending >= this.limit) {
      this.add(callback, top);
      return;
    }

    this.pending++;
    const response = await callback();
    this.pending--;

    return response;
  }

  private add(callback: () => any, top?: boolean) {
    if (top) {
      this.queue.unshift(callback);
      return;
    }

    this.queue.push(callback);
  }

  private async next() {
    if (this.pending >= this.limit) return;
    const next = this.queue.shift();

    this.pending++;
    await next?.();
    this.pending--;
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
