import _ from "lodash";
import os from "os";
import pm2 from "pm2";
import { RequestQueueService } from "@/services/RequestQueueService";
import { calculateAvg } from "@/helpers/number";

export class RequestQueueRegulator {
  private queueService;
  private adjustInterval = 5 * 60;
  private limitStep = 1000;
  private scrapersCount: number | undefined;

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

    const cpusCount = os.cpus().length;
    const targetedCpu = (cpusCount * 70) / this.scrapersCount;
    const avgCpu = calculateAvg(this.queueService.cpuHistory);

    const targetedMem = 80 / this.scrapersCount;
    const totalMem = os.totalmem();
    const usedMem = (process.memoryUsage().rss * 100) / totalMem;

    const diffMem = (targetedMem - usedMem) / targetedMem;
    const diffCpu = (targetedCpu - avgCpu) / targetedCpu;
    const minDiff = Math.min(diffCpu, diffMem);
    this.queueService.limit += Math.round(minDiff * this.limitStep);
  }
}
