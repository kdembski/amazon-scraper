import { AmazonPdpCountryScraper } from "@/scrapers/amazon/abstract/AmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class RequestAmazonPdpCountryScraper extends AmazonPdpCountryScraper {
  private amazonService;

  constructor(amazonService = AmazonService.getInstance()) {
    super();
    this.amazonService = amazonService;
  }

  execute(
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    const price = this.priceHelper.getPrice(prices, country.id);

    if (!(price && this.priceHelper.isScrapable(price))) return;

    const { url, referer } = this.builder.buildUrl(country, ad);
    price.pending = true;

    this.amazonService.get<string>(url, referer, {
      onSuccess: (res) =>
        this.onSuccess(res, country, price, ad, prices, resolve),
      onError: (e) => this.onError(e, country, price, ad, prices, resolve),
    });
  }

  private async onSuccess(
    data: string,
    country: Country,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    price.pending = false;

    if (!data.length) {
      this.retry(country, ad, prices, resolve);
      return;
    }

    const { document } = parseHTML(data);
    const pdpAd = this.builder.build(document);

    if (pdpAd?.isCaptcha) {
      this.retry(country, ad, prices, resolve);
      return;
    }

    price.value = pdpAd?.price;
    this.amazonService.queueService.completed++;
    this.tryComplete(ad, prices, resolve);
  }

  private onError(
    e: any,
    country: Country,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolve: () => void
  ) {
    price.pending = false;

    if (e.status === 404) {
      this.amazonService.queueService.completed++;
      this.tryDelete(ad, price, prices, resolve);
      return;
    }

    if (price.failed > 100) {
      this.amazonService.queueService.failed++;
      this.tryComplete(ad, prices, resolve);
      return;
    }

    price.failed++;
    this.retry(country, ad, prices, resolve);
  }
}
