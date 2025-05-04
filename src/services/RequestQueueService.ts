import _ from "lodash";
import osu from "node-os-utils";
import pm2 from "pm2";
import pidusage from "pidusage";
import { ArgsService } from "@/services/ArgsService";

export class RequestQueueService {
  private argsService;
  private completedHistory: number[] = [];
  private globalCpuHistory: number[] = [];
  private localCpuHistory: number[] = [];
  private adjustInterval = 1 * 60;
  private limitStep = 4000;
  private previousCompleted = 0;
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
    argsService = ArgsService.getInstance()
  ) {
    this.limit = limit;
    this.argsService = argsService;

    setInterval(() => {
      this.updateCompletedHistory();
      this.updateGlobalCpuHistory();
      this.updateLocalCpuHistory();
      this.calculateSpeed();

      this.previousCompleted = this.completed;
    }, 1000);

    if (enableLogs) {
      setInterval(this.logState, 1000);
    }

    if (enableRegulation) {
      setInterval(() => this.adjustLimit, this.adjustInterval * 1000);
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

  private add(callback: () => any, top?: boolean) {
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

  private async updateGlobalCpuHistory() {
    const usage = await osu.cpu.usage();

    const length = this.globalCpuHistory.unshift(usage);
    this.globalCpuHistory.length = Math.min(length, 10 * 60);
  }

  private async updateLocalCpuHistory() {
    const usage = (await pidusage(process.pid)).cpu;

    const length = this.localCpuHistory.unshift(usage);
    this.localCpuHistory.length = Math.min(length, 10 * 60);
  }

  private calculateSpeed() {
    if (!this.completedHistory.length) {
      return;
    }

    this.speed = this.calculateAvg(this.completedHistory);
  }

  private calculateAvg(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private roundToTwoDecimals(value?: number) {
    return !_.isNil(value) ? (Math.round(value * 100) / 100).toFixed(2) : "-";
  }

  private logState() {
    const stats = [
      `speed: ${this.roundToTwoDecimals(this.speed)}/s`,
      `cpu: ${Math.round(this.calculateAvg(this.localCpuHistory))}%`,
      `pending: ${this.pending}`,
      `queue: ${this.queue.length}`,
      `failed: ${this.failed}`,
      `completed: ${this.completed}`,
    ];
    const text = stats.join(` | `);
    console.log(text);
  }

  private async adjustLimit() {
    const avgGlobalCpu = this.calculateAvg(this.globalCpuHistory);
    const avgLocalCpu = this.calculateAvg(this.localCpuHistory);
    const cpusCount = osu.cpu.count();

    const { totalMemMb, usedMemMb } = await osu.mem.used();
    const avgMem = (usedMemMb * 100) / totalMemMb;

    pm2.list((e, list) => {
      if (e) return;

      const scrapersCount = list.filter((p) => p.name?.includes("pdp")).length;
      const targetedCpu = (cpusCount * 80) / scrapersCount;

      if (avgMem > 80 || avgGlobalCpu > 80) {
        this.limit -= this.limitStep;
        return;
      }

      const diff = targetedCpu - avgLocalCpu;
      this.limit += (diff / 100) * this.limitStep;
    });
  }
}
