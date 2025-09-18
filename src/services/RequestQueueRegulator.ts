import _ from "lodash";
import os from "os";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ApiService } from "@/services/ApiService";

export class RequestQueueRegulator {
  private queueService;
  private apiService;
  private adjustInterval = 20 * 60;
  private limitStep = 500;
  scrapersCount: number | undefined;
  targetedGlobalCpu = 50;

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

    const mem = await this.getMemoryUsage();
    if (mem > 90) return;

    const cpusCount = os.cpus().length;
    const [avgGlobalCpu, avgProcessCpu] = await Promise.all(this.getAvgCpus());

    const targetedCpu =
      (cpusCount * this.targetedGlobalCpu) / this.scrapersCount;
    const diffCpu = (targetedCpu - avgProcessCpu) / targetedCpu;

    this.queueService.limit += Math.round(diffCpu * this.limitStep);
    this.queueService.limit = Math.max(this.queueService.limit, 100);
    this.updateTargetedValues(avgGlobalCpu);
  }

  private updateTargetedValues(avgGlobalCpu: number) {
    const globalCpuLimit = 80;

    const step = (globalCpuLimit - avgGlobalCpu) / 2;
    if (step > -0.5 && step < 0.5) return;

    const target = this.targetedGlobalCpu + step;
    this.targetedGlobalCpu = Math.max(Math.min(target, 100), 1);
  }

  private getAvgCpus() {
    return [
      this.apiService.get<number>(`system/cpu`),
      this.apiService.get<number>(`scrapers/${process.env.name}/cpu`),
    ];
  }

  private getMemoryUsage() {
    return this.apiService.get<number>(`system/mem`);
  }
}
