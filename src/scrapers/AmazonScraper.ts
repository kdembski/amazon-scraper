import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
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
    const apiService = ApiService.getInstance();
    const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
    const countries = await apiService.get<Country[]>("countries");

    const promises = ads.map((ad) => {
      return new AmazonPdpScraper(ad, countries).execute();
    });

    await Promise.all(promises);

    this.scrapPdp();
  }
}
