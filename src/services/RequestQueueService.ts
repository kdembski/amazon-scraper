import { ArgsService } from "@/services/ArgsService";
import _ from "lodash";

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
        const text = `speed: ${this.speed}/s | pending: ${this.pending} | queue: ${this.queue.length} | failed: ${this.failed} | completed: ${this.completed}`;
        console.log(text);
      }

      this.lastRequestCount = this.requestCount;
    }, 1000);
  }

  async request(callback: () => Promise<any>, top?: boolean) {
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

  private next() {
    if (this.pending >= this.pendingLimit) return;
    const next = this.queue.shift();
    next?.();
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
