import _ from "lodash";
import osu from "node-os-utils";
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

    const avgCpu = calculateAvg(this.queueService.cpuHistory);
    const cpusCount = osu.cpu.count();
    const targetedCpu = (cpusCount * 70) / this.scrapersCount;

    const { totalMemMb, usedMemMb } = await osu.mem.used();
    const avgMem = (usedMemMb * 100) / totalMemMb;

    if (avgMem > 80) {
      this.queueService.limit -= this.limitStep;
      return;
    }

    const diff = targetedCpu - avgCpu;
    this.queueService.limit += Math.round((diff / 100) * this.limitStep);
  }
}
