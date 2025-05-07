import { calculateAvg, roundToTwoDecimals } from "@/helpers/number";
import { RequestQueueRegulator } from "@/services/RequestQueueRegulator";

export class RequestQueueService {
  private completedHistory: number[] = [];
  private cpuUsage?: NodeJS.CpuUsage;
  private cpuStartTime?: [number, number];
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
    regulator = new RequestQueueRegulator(this)
  ) {
    this.limit = limit;

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
    setTimeout(() => {
      this.next();
      this.start();
    }, 1);
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
    if (!this.cpuUsage) {
      this.cpuUsage = process.cpuUsage();
      this.cpuStartTime = process.hrtime();
      return;
    }

    const elapTime = process.hrtime(this.cpuStartTime);
    const elapUsage = process.cpuUsage(this.cpuUsage);

    const elapTimeMS = elapTime[0] * 1000 + elapTime[1] / 1000000;
    const elapUserMS = elapUsage.user / 1000;
    const elapSystMS = elapUsage.system / 1000;

    const cpuPercent = Math.round(
      (100 * (elapUserMS + elapSystMS)) / elapTimeMS
    );
    const length = this.cpuHistory.unshift(cpuPercent);
    this.cpuHistory.length = Math.min(length, 60 * 60);

    this.cpuUsage = process.cpuUsage();
    this.cpuStartTime = process.hrtime();
  }

  private calculateSpeed() {
    if (!this.completedHistory.length) return;
    this.speed = calculateAvg(this.completedHistory);
  }

  private logState() {
    const stats = [
      `speed: ${roundToTwoDecimals(this.speed)}/s`,
      `cpu: ${Math.round(calculateAvg(this.cpuHistory))}%`,
      `limit: ${this.limit}`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }
}
