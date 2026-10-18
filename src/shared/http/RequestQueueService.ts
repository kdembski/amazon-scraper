export class RequestQueueService {
  queue: (() => any)[] = [];
  pending = 0;
  limit;
  rate;
  private tokens;
  private lastRefill = Date.now();
  private countConnections;

  constructor(
    limit: number,
    rate = 0,
    enableLogs = false,
    countConnections?: () => number
  ) {
    this.limit = limit;
    this.rate = rate;
    this.tokens = rate;
    this.countConnections = countConnections;

    if (enableLogs) {
      setInterval(() => this.logState(), 1000);
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

  async request(callback: () => Promise<void>) {
    if (!this.canStart()) {
      this.queue.push(callback);
      return;
    }

    return this.run(callback);
  }

  private async next() {
    if (!this.queue.length || !this.canStart()) return;
    const next = this.queue.shift()!;

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

  private logState() {
    const stats = [
      `rate: ${this.rate || "-"}/s`,
      `limit: ${this.limit}`,
      `pending: ${this.pending}`,
      ...(this.countConnections
        ? [`connections: ${this.countConnections()}`]
        : []),
      `queue: ${this.queue.length}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }
}
