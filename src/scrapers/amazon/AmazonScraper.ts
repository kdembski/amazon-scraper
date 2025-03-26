import { AmazonPdpScraper } from "@/scrapers/amazon/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/amazon/AmazonPlpScraper";
import { RequestAmazonPdpCountryScraper } from "@/scrapers/amazon/RequestAmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { AmazonAd } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private apiService;
  private amazonService;
  private argsService;
  private pdpScraper;
  private plpScraper;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance(),
    pdpScraper = new AmazonPdpScraper(new RequestAmazonPdpCountryScraper()),
    plpScraper = new AmazonPlpScraper()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
    this.pdpScraper = pdpScraper;
    this.plpScraper = plpScraper;
  }

  async execute() {
    this.scrapPdp();
    new CronJob("0 0 2 * * *", () => this.scrapPlp()).start();
  }

  async scrapPlp(name?: string) {
    const categories = await this.apiService.getCategories();
    const randomIndex = Math.floor(Math.random() * categories.length);
    const random = categories[randomIndex]?.name;
    await this.plpScraper.execute(name || random);
  }

  async scrapPdp() {
    if (this.amazonService.queueService.queue.length > 0) {
      setTimeout(() => this.scrapPdp(), 5000);
      return;
    }

    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;
    const count = this.argsService.getCountFlag();
    const countries = await this.apiService.getCountries();

    this.apiService.get<AmazonAd[]>(
      `amazon/ads/scrap?count=${count}`,
      {
        onSuccess: async (ads) => {
          const promises = ads.map((ad) =>
            this.pdpScraper.execute(ad, countries)
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
}
