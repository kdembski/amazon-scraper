// Runs at most `concurrency` callbacks at once and starts at most `rps` per second, evenly spaced
export class ThrottledQueue {
  private queue: (() => Promise<void>)[] = [];
  private pending = 0;
  private lastStart = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private concurrency;
  private interval;

  constructor(concurrency: number, rps: number) {
    this.concurrency = concurrency;
    this.interval = 1000 / rps;
  }

  request<T>(callback: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => callback().then(resolve, reject));
      this.next();
    });
  }

  private next() {
    if (!this.queue.length || this.pending >= this.concurrency || this.timer) return;

    const wait = this.lastStart + this.interval - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.next();
      }, wait);
      return;
    }

    this.lastStart = Date.now();
    this.pending++;
    this.queue
      .shift()!()
      .finally(() => {
        this.pending--;
        this.next();
      });
    this.next();
  }
}
