import { AmazonPdpScraper } from "@/marketplaces/amazon/pdp/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/marketplaces/amazon/plp/AmazonPlpScraper";
import { AmazonPdpCountryScraper } from "@/marketplaces/amazon/pdp/AmazonPdpCountryScraper";
import { AmazonService } from "@/marketplaces/amazon/AmazonService";
import { ApiService } from "@/shared/backend/ApiService";
import { CountryService } from "@/shared/backend/CountryService";
import { ArgsService } from "@/shared/args/ArgsService";
import { ProxyService } from "@/shared/http/proxy/ProxyService";
import { AmazonAd, AmazonAdCategory } from "@/marketplaces/amazon/types/amazon.types";
import { MarketplaceScraper } from "@/shared/interfaces/MarketplaceScraper";
import { CronJob } from "cron";

export class AmazonScraper implements MarketplaceScraper {
  readonly marketplace = "amazon";
  private apiService;
  private amazonService;
  private argsService;
  private pdpScraper;
  private plpScraper;
  private proxyService;
  private countryService;
  private isLoadingAds = false;
  private categoryRetryDelay = 60 * 1000;

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    argsService = ArgsService.getInstance(),
    pdpScraper = new AmazonPdpScraper(new AmazonPdpCountryScraper()),
    plpScraper = new AmazonPlpScraper(),
    proxyService = ProxyService.getInstance(),
    countryService = CountryService.getInstance()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.argsService = argsService;
    this.pdpScraper = pdpScraper;
    this.plpScraper = plpScraper;
    this.proxyService = proxyService;
    this.countryService = countryService;
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
    this.apiService
      .get<AmazonAdCategory>("amazon/ads/categories/scrap")
      .then((category) => this.plpScraper.execute(category.name))
      .catch(() => {
        setTimeout(() => this.scrapPlp(), this.categoryRetryDelay);
      });
  }

  async scrapPdp() {
    if (this.isLoadingAds) return;

    const count = this.argsService.getCountFlag();
    if (this.amazonService.queueService.queue.length > count / 10) return;

    this.isLoadingAds = true;

    try {
      const countries = await this.countryService.getCountries();
      const ads = await this.apiService.get<AmazonAd[]>(
        `amazon/ads/scrap?count=${count}`
      );
      ads.forEach((ad) => this.pdpScraper.execute(ad, countries));
    } finally {
      this.isLoadingAds = false;
    }
  }
}
