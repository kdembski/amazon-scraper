export class RequestQueueService {
  queue: (() => any)[] = [];
  pending = 0;
  concurrency;
  rps;
  private tokens;
  private lastRefill = Date.now();
  private countConnections;

  constructor(
    concurrency: number,
    rps = 0,
    enableLogs = false,
    countConnections?: () => number
  ) {
    this.concurrency = concurrency;
    this.rps = rps;
    this.tokens = rps;
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

  setRps(rps: number) {
    this.rps = rps;
    this.tokens = Math.min(this.tokens, rps);
    this.lastRefill = Date.now();
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
    if (this.rps) this.tokens--;

    this.pending++;
    try {
      return await callback();
    } finally {
      this.pending--;
      this.next();
    }
  }

  private canStart() {
    if (this.pending >= this.concurrency) return false;
    if (!this.rps) return true;

    this.refillTokens();
    return this.tokens >= 1;
  }

  // Token bucket holding at most one second worth of requests
  private refillTokens() {
    const now = Date.now();
    const refill = ((now - this.lastRefill) * this.rps) / 1000;

    this.tokens = Math.min(this.rps, this.tokens + refill);
    this.lastRefill = now;
  }

  private logState() {
    const stats = [
      `rps: ${this.rps || "-"}/s`,
      `concurrency: ${this.concurrency}`,
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
