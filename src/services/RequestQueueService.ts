import _ from "lodash";
import { ArgsService } from "@/services/ArgsService";

export class RequestQueueService {
  private argsService;
  private speedHistory: number[] = [];
  private adjustInterval = 20 * 60;
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
        this.updateSpeedHistory();
        this.calculateSpeed();
        this.logState();

        this.previousCompleted = this.completed;
      }, 1000);

      setInterval(() => {
        this.adjustLimit();
      }, this.adjustInterval * 1000);
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

  private updateSpeedHistory() {
    let speed = this.completed - this.previousCompleted;
    speed = speed < 0 ? 0 : speed;

    const length = this.speedHistory.unshift(speed);
    this.speedHistory.length = Math.min(length, 24 * 60 * 60);
  }

  private calculateSpeed() {
    if (!this.speedHistory.length) {
      return;
    }

    this.speed = Math.round(this.calculateAvg(this.speedHistory));
  }

  private calculateAvg(values: number[]) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private logState() {
    const sum = this.pending + this.queue.length + this.completed;
    const stats = [
      `speed: ${this.speed}/s`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
      `sum: ${sum}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }

  private adjustLimit() {
    const skip = 3;

    if (this.speedHistory.length < this.adjustInterval * skip) {
      return;
    }

    const current = this.calculateAvg(this.speedHistory);

    if (!this.targetedSpeed) {
      this.targetedSpeed = current + 1;
    }

    const diff = this.targetedSpeed - current;

    if (diff < 0.25) {
      this.targetedSpeed += 1;
      this.limit += 1000;
      return;
    }

    if (diff >= 0.25 && diff <= 1.5) {
      this.limit += diff * 1000;
      return;
    }

    if (diff > 1.5 && diff <= 2) {
      this.limit -= (diff - 1) * 1000;
      return;
    }

    if (diff > 2) {
      this.targetedSpeed -= 1;
    }
  }
}
