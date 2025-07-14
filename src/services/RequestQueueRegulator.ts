import _ from "lodash";
import os from "os";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ApiService } from "@/services/ApiService";

export class RequestQueueRegulator {
  private queueService;
  private apiService;
  private adjustInterval = 20 * 60;
  private limitStep = 100;
  scrapersCount: number | undefined;
  targetedGlobalCpu = 50;
  targetedGlobalMem = 100;

  constructor(
    queueService: RequestQueueService,
    apiService = ApiService.getInstance()
  ) {
    this.queueService = queueService;
    this.apiService = apiService;
  }

  start() {
    setInterval(() => this.adjustLimit(), this.adjustInterval * 1000);
    setInterval(() => this.updateScrapersCount(), 60 * 60 * 1000);
  }

  private async updateScrapersCount() {
    this.scrapersCount = await this.apiService.get<number>(`scrapers/count`);
  }

  private async adjustLimit() {
    if (!this.scrapersCount) {
      await this.updateScrapersCount();
      return;
    }

    const cpusCount = os.cpus().length;
    const [avgGlobalCpu, avgProcessCpu] = await Promise.all(this.getAvgCpus());

    const totalMem = os.totalmem();
    const usedGlobalMem = ((totalMem - os.freemem()) * 100) / totalMem;
    const usedProcessMem = (process.memoryUsage().rss * 100) / totalMem;

    const targetedCpu =
      (cpusCount * this.targetedGlobalCpu) / this.scrapersCount;
    const targetedMem = this.targetedGlobalMem / this.scrapersCount;

    const diffMem = (targetedMem - usedProcessMem) / targetedMem;
    const diffCpu = (targetedCpu - avgProcessCpu) / targetedCpu;
    const minDiff = Math.min(diffCpu, diffMem);

    this.queueService.limit += Math.round(minDiff * this.limitStep);
    this.queueService.limit = Math.max(this.queueService.limit, 100);
    this.updateTargetedValues(diffCpu, diffMem, avgGlobalCpu, usedGlobalMem);
  }

  private updateTargetedValues(
    diffCpu: number,
    diffMem: number,
    avgGlobalCpu: number,
    usedGlobalMem: number
  ) {
    const globalCpuLimit = 80;
    const globalMemLimit = 80;

    if (diffCpu <= diffMem) {
      const step = (globalCpuLimit - avgGlobalCpu) / 2;
      if (step > -0.5 && step < 0.5) return;

      const target = this.targetedGlobalCpu + step;
      this.targetedGlobalCpu = Math.max(Math.min(target, 100), 1);
      return;
    }

    const target = this.targetedGlobalMem + (globalMemLimit - usedGlobalMem);
    this.targetedGlobalMem = Math.max(Math.min(target, 100), 1);
  }

  private getAvgCpus() {
    return [
      this.apiService.get<number>(`system/cpu`),
      this.apiService.get<number>(`scrapers/${process.env.name}/cpu`),
    ];
  }
}
