import pidusage from "pidusage";
import { ArgsService } from "@/services/ArgsService";
import { calculateAvg, roundToTwoDecimals } from "@/helpers/number";
import { RequestQueueRegulator } from "@/services/RequestQueueRegulator";

export class RequestQueueService {
  private argsService;
  private regulator;
  private completedHistory: number[] = [];
  cpuHistory: number[] = [];
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
    argsService = ArgsService.getInstance(),
    regulator = new RequestQueueRegulator(this)
  ) {
    this.limit = limit;
    this.argsService = argsService;
    this.regulator = regulator;

    setInterval(() => {
      this.updateCompletedHistory();
      this.updateCpuHistory();
      this.calculateSpeed();

      this.previousCompleted = this.completed;
    }, 1000);

    if (enableLogs) {
      setInterval(() => this.logState(), 1000);
    }

    if (enableRegulation) {
      regulator.start();
    }
  }

  start() {
    const delay = Math.floor(Math.random() * this.argsService.getDelayFlag());

    setTimeout(() => {
      this.next();
      this.start();
    }, delay);
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
  }

  private async updateCpuHistory() {
    const usage = (await pidusage(process.pid)).cpu;

    const length = this.cpuHistory.unshift(usage);
    this.cpuHistory.length = Math.min(length, 10 * 60);
  }

  private calculateSpeed() {
    if (!this.completedHistory.length) return;
    this.speed = calculateAvg(this.completedHistory);
  }

  private logState() {
    const stats = [
      `speed: ${roundToTwoDecimals(this.speed)}/s`,
      `cpu: ${Math.round(calculateAvg(this.cpuHistory))}%`,
      `scrapers: ${this.regulator.scrapersCount || "-"}`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }
}
