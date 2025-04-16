import _ from "lodash";
import osu from "node-os-utils";
import { ArgsService } from "@/services/ArgsService";

export class RequestQueueService {
  private argsService;
  private completedHistory: number[] = [];
  private cpuHistory: number[] = [];
  private adjustInterval = 10 * 60;
  private limitStep = 3000;
  queue: Function[] = [];
  speed = 0;
  completed = 0;
  previousCompleted = 0;
  failed = 0;
  pending = 0;
  limit;
  targetedSpeed?: number;

  constructor(
    limit: number,
    enableLogs = false,
    argsService = ArgsService.getInstance()
  ) {
    this.limit = limit;
    this.argsService = argsService;

    if (enableLogs) {
      setInterval(() => {
        this.updateCompletedHistory();
        this.updateCpuHistory();
        this.calculateSpeed();
        this.logState();

        this.previousCompleted = this.completed;
      }, 1000);

      setInterval(() => {
        this.adjustLimit();
      }, this.adjustInterval * 1000);

      setInterval(() => {
        this.limit += this.limitStep;
      }, 5 * this.adjustInterval * 1000);

      setTimeout(() => {
        this.limitStep = this.limitStep / 2;
      }, 10 * this.adjustInterval * 1000);

      setTimeout(() => {
        this.limitStep = this.limitStep / 2;
      }, 20 * this.adjustInterval * 1000);
    }
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

  add(callback: () => any, top?: boolean) {
    if (top) {
      this.queue.unshift(callback);
      return;
    }

    this.queue.push(callback);
  }

  start() {
    const delay = Math.floor(Math.random() * this.argsService.getDelayFlag());

    setTimeout(() => {
      this.next();
      this.start();
    }, delay);
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
    const usage = await osu.cpu.usage();

    const length = this.cpuHistory.unshift(usage);
    this.cpuHistory.length = Math.min(length, 10 * 60);
  }

  private calculateSpeed() {
    if (!this.completedHistory.length) {
      return;
    }

    this.speed = this.calculateAvg(this.completedHistory);
  }

  private calculateAvg(values: number[]) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private logState() {
    const stats = [
      `speed: ${this.roundToTwoDecimals(this.speed)}/s`,
      `target: ${this.roundToTwoDecimals(this.targetedSpeed)}/s`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }

  private roundToTwoDecimals(value?: number) {
    return !_.isNil(value) ? (Math.round(value * 100) / 100).toFixed(2) : "-";
  }

  private async adjustLimit() {
    const skipIntervals = 3;
    const speedStep = 0.2;

    if (this.completedHistory.length < this.adjustInterval * skipIntervals) {
      return;
    }

    const currentCpu = this.calculateAvg(this.cpuHistory);
    const { totalMemMb, usedMemMb } = await osu.mem.used();
    const currentMem = (usedMemMb * 100) / totalMemMb;
    const currentSpeed = this.calculateAvg(this.completedHistory);

    if (!this.targetedSpeed) {
      this.targetedSpeed = currentSpeed + speedStep * 0.5;
    }

    if (currentMem > 90) {
      this.limit -= 2 * this.limitStep;
      return;
    }

    if (currentCpu > 85) {
      this.limit -= 2 * this.limitStep;
      return;
    }

    if (currentMem > 80) {
      this.limit -= this.limitStep;
      return;
    }

    if (currentCpu > 75) {
      this.limit -= this.limitStep;
      return;
    }

    const speedDiff = this.targetedSpeed - currentSpeed;

    if (speedDiff < -speedStep * 0.5) {
      this.targetedSpeed += speedStep;
      this.limit += this.limitStep * 2;
      return;
    }

    if (speedDiff >= -speedStep * 0.5 && speedDiff <= speedStep) {
      this.limit += (speedStep + speedDiff) * this.limitStep * 3;
      return;
    }

    if (speedDiff > speedStep && speedDiff <= speedStep * 1.5) {
      this.limit -= speedDiff * this.limitStep;
      return;
    }

    if (speedDiff > speedStep * 1.5) {
      this.targetedSpeed -= speedStep;
      this.limit += this.limitStep;
    }
  }
}
