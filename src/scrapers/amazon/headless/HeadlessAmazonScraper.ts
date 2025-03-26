import { AmazonPdpScraper } from "@/scrapers/amazon/AmazonPdpScraper";
import { HeadlessAmazonPdpCountryScraper } from "@/scrapers/amazon/headless/HeadlessAmazonPdpCountryScraper";
import { ApiService } from "@/services/ApiService";
import { ArgsService } from "@/services/ArgsService";
import { PlaywrightService } from "@/services/PlaywrightService";
import { AmazonAd } from "@/types/amazon.types";

export class HeadlessAmazonScraper {
  private apiService;
  private pdpScraper;
  private argsService;
  private playwrightService;

  constructor(
    apiService = ApiService.getInstance(),
    argsService = ArgsService.getInstance(),
    pdpScraper = new AmazonPdpScraper(new HeadlessAmazonPdpCountryScraper()),
    playwrightService = PlaywrightService.getInstance()
  ) {
    this.apiService = apiService;
    this.pdpScraper = pdpScraper;
    this.argsService = argsService;
    this.playwrightService = playwrightService;
  }

  async execute() {
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
          this.execute();
        },
        onFinally: () => {},
      },
      true
    );
  }
}
