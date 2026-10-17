import { AmazonPdpScraper } from "@/scrapers/AmazonPdpScraper";
import { AmazonPlpScraper } from "@/scrapers/AmazonPlpScraper";
import { RequestAmazonPdpCountryScraper } from "@/scrapers/RequestAmazonPdpCountryScraper";
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
  private categoryRetryDelay = 60 * 1000;

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

    this.apiService
      .get<AmazonAdCategory>("amazon/ads/categories/scrap")
      .then((category) => this.plpScraper.execute(category.name))
      // Wait before asking again, so a backend outage is not flooded
      .catch(() => {
        setTimeout(() => this.scrapPlp(), this.categoryRetryDelay);
      });
  }

  async scrapPdp() {
    if (this.isLoadingAds) return;

    const count = this.argsService.getCountFlag();
    if (this.amazonService.queueService.queue.length > count / 10) return;

    this.isLoadingAds = true;
    this.amazonService.queueService.failed = 0;
    this.amazonService.queueService.completed = 0;

    try {
      const countries = await this.apiService.getCountries();
      const ads = await this.apiService.get<AmazonAd[]>(
        `amazon/ads/scrap?count=${count}`
      );
      ads.forEach((ad) => this.pdpScraper.execute(ad, countries));
    } finally {
      this.isLoadingAds = false;
    }
  }
}
