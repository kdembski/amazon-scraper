import { AmazonPdpScraper } from "@/scrapers/amazon/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/amazon/AmazonPlpScraper";
import { RequestAmazonPdpCountryScraper } from "@/scrapers/amazon/RequestAmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { ProxyService } from "@/services/ProxyService";
import { AmazonAd, AmazonAdCategory } from "@/types/amazon.types";
import { CronJob } from "cron";

export class AmazonScraper {
  private apiService;
  private amazonService;
  private argsService;
  private pdpScraper;
  private plpScraper;
  private proxyService;
  private isLoadingAds = false;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance(),
    pdpScraper = new AmazonPdpScraper(new RequestAmazonPdpCountryScraper()),
    plpScraper = new AmazonPlpScraper(),
    proxyService = ProxyService.getInstance()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
    this.pdpScraper = pdpScraper;
    this.plpScraper = plpScraper;
    this.proxyService = proxyService;
  }

  async execute() {
    const { isPdp, isPlp } = this.argsService.getTargetFlag();
    await this.proxyService.loadProxies();

    if (isPdp) {
      this.scrapPdp();
      setInterval(() => this.scrapPdp(), 5 * 1000);
    }

    if (isPlp) {
      this.scrapPlp();
      new CronJob("0 0 */1 * * *", () => this.scrapPlp()).start();
    }
  }

  async scrapPlp() {
    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;

    return this.apiService.get<AmazonAdCategory>(
      "amazon/ads/categories/scrap",
      {
        onSuccess: (category) => {
          this.plpScraper.execute(category.name);
        },
        onError: () => this.scrapPlp(),
      }
    );
  }

  async scrapPdp() {
    if (this.isLoadingAds) return;

    const count = this.argsService.getCountFlag();
    if (this.amazonService.queueService.queue.length > count / 10) return;

    this.isLoadingAds = true;
    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;
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
          this.isLoadingAds = false;
        },
      },
      true
    );
  }
}
