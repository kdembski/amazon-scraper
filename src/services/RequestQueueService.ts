import _ from "lodash";
import { styleText } from "node:util";
import { ArgsService } from "@/services/ArgsService";

export class RequestQueueService {
  private argsService;
  private lastRequestCount = 0;
  private requestCount = 0;
  private speedHistory: number[] = [];
  speed = 0;
  completed = 0;
  failed = 0;
  pending = 0;
  pendingLimit;
  queue: Function[] = [];

  constructor(
    pendingLimit: number,
    logs = false,
    argsService = ArgsService.getInstance()
  ) {
    this.pendingLimit = pendingLimit;
    this.argsService = argsService;

    setInterval(() => {
      this.requestCount = this.pending + this.queue.length;
      this.updateSpeedHistory();
      this.calculateSpeed();

      if (logs) {
        const sum = this.pending + this.queue.length + this.completed;
        const stats = [
          `${styleText("dim", "speed:")} ${this.speed}/s`,
          `${styleText("dim", "pending:")} ${this.pending}`,
          `${styleText("dim", "queue:")} ${this.queue.length}`,
          `${styleText("dim", "failed:")} ${this.failed}`,
          `${styleText("dim", "completed:")} ${this.completed}`,
          `${styleText("dim", "sum:")} ${sum}`,
        ];
        const text = stats.join(` ${styleText("dim", "|")} `);
        console.log(text);
      }

      this.lastRequestCount = this.requestCount;
    }, 1000);
  }

  async request(callback: () => Promise<void>, top?: boolean) {
    if (this.pending >= this.pendingLimit) {
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
    if (this.pending >= this.pendingLimit) return;
    const next = this.queue.shift();

    this.pending++;
    await next?.();
    this.pending--;
  }

  private updateSpeedHistory() {
    if (_.isNil(this.lastRequestCount) || _.isNil(this.requestCount)) return;

    let speed = this.lastRequestCount - this.requestCount;
    speed = speed < 0 ? 0 : speed;

    const length = this.speedHistory.unshift(speed);
    this.speedHistory.length = Math.min(length, 100);
  }

  private calculateSpeed() {
    if (!this.speedHistory.length) {
      return;
    }

    this.speed = Math.round(
      this.speedHistory.reduce((sum, v) => sum + v, 0) /
        this.speedHistory.length
    );
  }
}
