import { ArgsService } from "@/services/ArgsService";

export class RequestQueueService {
  private argsService;
  failed = 0;
  pending = 0;
  pendingLimit;
  queue: Function[] = [];

  constructor(
    pendingLimit: number,
    logWrapper: string,
    argsService = ArgsService.getInstance()
  ) {
    this.pendingLimit = pendingLimit;
    this.argsService = argsService;

    setInterval(() => {
      console.log(
        logWrapper,
        `pending: ${this.pending} | queue: ${this.queue.length} | failed: ${this.failed}`
      );
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
}
