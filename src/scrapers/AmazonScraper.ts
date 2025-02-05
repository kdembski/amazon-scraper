import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private categories = [
    "sporting",
    "fashion",
    "electronics",
    "computers",
    "home",
  ];

  constructor() {}

  execute() {
    const scrapPlpJob = new CronJob("0 0 2 * * *", () => this.scrapPlp());
    scrapPlpJob.start();
    this.scrapPdp();
  }

  async scrapPlp() {
    const category =
      this.categories[Math.floor(Math.random() * this.categories.length)];
    const promises = new AmazonPlpScraper(category, 400).execute();
    await Promise.all(promises);
  }

  async scrapPdp() {
    const amazonService = AmazonService.getInstance();
    if (amazonService.queue.length > 0) {
      setTimeout(() => this.scrapPdp(), 1000);
      return;
    }

    const apiService = ApiService.getInstance();
    const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
    const countries = await apiService.get<Country[]>("countries");

    ads.map((ad) => {
      return new AmazonPdpScraper(ad, countries).execute();
    });

    setTimeout(() => this.scrapPdp(), 1000);
  }
}
