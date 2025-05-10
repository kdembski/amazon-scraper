import _ from "lodash";
import os from "os";
import pm2 from "pm2";
import { RequestQueueService } from "@/services/RequestQueueService";
import { calculateAvg } from "@/helpers/number";

export class RequestQueueRegulator {
  private queueService;
  private adjustInterval = 5 * 60;
  private limitStep = 1000;
  scrapersCount: number | undefined;
  targetedGlobalCpu = 100;
  targetedGlobalMem = 100;

  constructor(queueService: RequestQueueService) {
    this.queueService = queueService;
  }

  start() {
    setInterval(() => this.adjustLimit(), this.adjustInterval * 1000);
    setInterval(() => this.updateScrapersCount(), 60 * 60 * 1000);
  }

  private updateScrapersCount() {
    return new Promise<void>((resolve, reject) => {
      pm2.list((e, list) => {
        if (e) {
          reject(e);
          return;
        }

        const scrapers = list.filter((p) => p.name?.includes("pdp"));
        this.scrapersCount = scrapers.length;
        resolve();
      });
    });
  }

  private async adjustLimit() {
    if (!this.scrapersCount) {
      await this.updateScrapersCount();
      return;
    }

    const targetedGlobalCpu = 80;
    const targetedGlobalMem = 80;

    const cpusCount = os.cpus().length;
    const avgGlobalCpu = calculateAvg(this.queueService.globalCpuHistory);
    const avgProcessCpu = calculateAvg(this.queueService.processCpuHistory);

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
}
