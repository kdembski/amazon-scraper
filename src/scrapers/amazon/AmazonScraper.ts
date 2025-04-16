import { AmazonPdpScraper } from "@/scrapers/amazon/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/amazon/AmazonPlpScraper";
import { RequestAmazonPdpCountryScraper } from "@/scrapers/amazon/RequestAmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { ProxyService } from "@/services/ProxyService";
import { AmazonAd, AmazonAdCategory } from "@/types/amazon.types";

export class AmazonScraper {
  private apiService;
  private amazonService;
  private argsService;
  private pdpScraper;
  private plpScraper;
  private proxyService;

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

    if (isPdp) await this.scrapPdp();
    if (isPlp) await this.scrapPlp();
  }

  async scrapPlp() {
    if (this.amazonService.queueService.queue.length > 0) {
      setTimeout(() => this.scrapPlp(), 5000);
      return;
    }

    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;

    return this.apiService.get<AmazonAdCategory>(
      "amazon/ads/categories/scrap",
      {
        onSuccess: (category) => {
          this.plpScraper.execute(category.name);
        },
        onError: () => this.scrapPlp(),
        onFinally: () => {
          setTimeout(() => this.scrapPlp(), 10000);
        },
      }
    );
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
