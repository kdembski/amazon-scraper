import _ from "lodash";
import os from "os";
import { RequestQueueService } from "@/services/RequestQueueService";
import { ApiService } from "@/services/ApiService";

export class RequestQueueRegulator {
  private queueService;
  private apiService;
  private adjustInterval = 10 * 60;
  private limitStep = 1000;
  scrapersCount: number | undefined;
  targetedGlobalCpu = 100;
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

    const targetedGlobalCpu = 70;
    const targetedGlobalMem = 80;

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

    if (diffCpu <= diffMem) {
      this.targetedGlobalCpu =
        this.targetedGlobalCpu + (targetedGlobalCpu - avgGlobalCpu);
      this.targetedGlobalCpu = Math.min(this.targetedGlobalCpu, 100);
      return;
    }

    this.targetedGlobalMem =
      this.targetedGlobalMem + (targetedGlobalMem - usedGlobalMem);
    this.targetedGlobalMem = Math.min(this.targetedGlobalMem, 100);
  }

  private getAvgCpus() {
    return [
      this.apiService.get<number>(`system/cpu`),
      this.apiService.get<number>(`scrapers/${process.env.name}/cpu`),
    ];
  }
}
