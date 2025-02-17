import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { AmazonAd, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private apiService;
  private amazonService;
  private argsService;
  private categories = [
    "sporting",
    "fashion",
    "electronics",
    "computers",
    "home",
  ];
  private countries: Country[] = [];
  private paused = false;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
  }

  async execute() {
    await this.loadCountries();

    this.scrapPdp();

    const scrapPlpJob = new CronJob("0 0 2 * * *", () => this.scrapPlp());
    scrapPlpJob.start();

    const pauseJob = new CronJob("0 0 4 * * *", () => {
      this.paused = true;

      setTimeout(() => {
        this.paused = false;
        this.scrapPdp();
      }, 60 * 60 * 1000);
    });

    pauseJob.start();
  }

  async scrapPlp() {
    const category =
      this.categories[Math.floor(Math.random() * this.categories.length)];
    const promises = new AmazonPlpScraper(category, 400).execute();
    await Promise.all(promises);
  }

  scrapPdp() {
    if (this.paused) return;

    if (this.amazonService.queueService.queue.length > 0) {
      setTimeout(() => this.scrapPdp(), 1000);
      return;
    }

    this.amazonService.queueService.failed = 0;
    const count = this.argsService.getCountFlag();

    this.apiService.get<AmazonAd[]>(
      `amazon/ads/scrap?count=${count}`,
      {
        onSuccess: async (ads) => {
          const promises = ads.map((ad) => {
            return new AmazonPdpScraper(ad, this.countries).execute();
          });
          await Promise.all(promises);
        },
        onFinally: () => {
          setTimeout(() => this.scrapPdp(), 1000);
        },
      },
      true
    );
  }

  async loadCountries() {
    return this.apiService.get<Country[]>("countries", {
      onSuccess: (countries) => {
        this.countries = countries;
      },
    });
  }
}
