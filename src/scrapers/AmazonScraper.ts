import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { AmazonAd, AmazonAdCategory, Country } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private apiService;
  private amazonService;
  private argsService;
  private pdpScraper;
  private plpScraper;
  private categories: AmazonAdCategory[] = [];
  private countries: Country[] = [];
  private failed: Record<string, number> = {};

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance(),
    pdpScraper = new AmazonPdpScraper(this.failed),
    plpScraper = new AmazonPlpScraper()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
    this.pdpScraper = pdpScraper;
    this.plpScraper = plpScraper;
  }

  async execute() {
    await this.loadCountries();
    await this.loadCategories();
    this.scrapPdp();

    new CronJob("0 0 2 * * *", () => this.scrapPlp()).start();

    new CronJob("0 0 0 * * *", async () => {
      await this.loadCountries();
      await this.loadCategories();
    }).start();
  }

  async scrapPlp(name?: string) {
    const random =
      this.categories[Math.floor(Math.random() * this.categories.length)]?.name;
    await this.plpScraper.execute(name || random);
  }

  scrapPdp() {
    if (this.amazonService.queueService.queue.length > 0) {
      setTimeout(() => this.scrapPdp(), 5000);
      return;
    }

    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;
    const count = this.argsService.getCountFlag();

    this.apiService.get<AmazonAd[]>(
      `amazon/ads/scrap?count=${count}`,
      {
        onSuccess: async (ads) => {
          const promises = ads.map((ad) =>
            this.pdpScraper.execute(ad, this.countries)
          );
          await Promise.all(promises);
        },
        onFinally: () => {
          setTimeout(() => this.scrapPdp(), 10000);
        },
      },
      true
    );
  }

  async loadCountries() {
    return this.apiService.get<Country[]>("countries", {
      onSuccess: (countries) => {
        this.countries = countries;

        this.failed = Object.fromEntries(
          countries.map((country) => [country.code, 0])
        );
      },
    });
  }

  async loadCategories() {
    return this.apiService.get<AmazonAdCategory[]>("amazon/ads/categories", {
      onSuccess: (categories) => {
        this.categories = categories;
      },
    });
  }
}
