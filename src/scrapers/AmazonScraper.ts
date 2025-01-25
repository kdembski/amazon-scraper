import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { ApiService } from "@/services/ApiService";
import { AmazonAd, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private isScrapingPlp = false;
  private isScrapingPdp = false;
  private categories = [
    "sporting",
    "fashion",
    "electronics",
    "computers",
    "videogames",
    "home",
  ];

  constructor() {}

  execute() {
    const scrapPlpJob = new CronJob("0 0 2 * * *", this.scrapPlp);
    scrapPlpJob.start();
    this.scrapPdp();
  }

  async scrapPlp() {
    this.isScrapingPlp = true;

    const promises = this.categories.flatMap((category) =>
      new AmazonPlpScraper(category, 400).execute()
    );

    await Promise.all(promises);
    this.isScrapingPlp = false;

    if (!this.isScrapingPdp) this.scrapPdp();
  }

  async scrapPdp() {
    if (this.isScrapingPlp) return;
    this.isScrapingPdp = true;

    const apiService = ApiService.getInstance();
    const ads = await apiService.get<AmazonAd[]>("amazon/ads/scrap");
    const countries = await apiService.get<Country[]>("countries");

    const promises = ads.map((ad) => {
      return new AmazonPdpScraper(ad, countries).execute();
    });

    await Promise.all(promises);
    this.isScrapingPdp = false;

    this.scrapPdp();
  }
}
