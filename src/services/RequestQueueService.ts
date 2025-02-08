export class RequestQueueService {
  pending = 0;
  pendingLimit;
  queue: Function[] = [];

  constructor(pendingLimit: number) {
    this.pendingLimit = pendingLimit;

    setInterval(() => {
      console.log(`pending: ${this.pending} | queue: ${this.queue.length}`);
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
    const delay = Math.floor(Math.random() * 100);

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
