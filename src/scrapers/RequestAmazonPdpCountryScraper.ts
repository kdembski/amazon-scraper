import { AmazonPdpCountryScraper } from "@/scrapers/abstract/AmazonPdpCountryScraper";
import { AmazonService } from "@/services/AmazonService";
import { AmazonAd, AmazonAdPrice } from "@/types/amazon.types";
import { parseHTML } from "linkedom";

export class RequestAmazonPdpCountryScraper extends AmazonPdpCountryScraper {
  private amazonService;

  constructor(amazonService = AmazonService.getInstance()) {
    super();
    this.amazonService = amazonService;
  }

  execute(
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    new Promise<boolean | undefined>((resolvePrice, rejectPrice) => {
      if (price.complete || price.deleted || price.pending || price.adDeleted) {
        return;
      }

      price.resolve = resolvePrice;
      price.reject = rejectPrice;

      const { url, referer } = this.builder.buildUrl(price.country, ad);
      price.pending = true;

      const controller = new AbortController();
      price.controller = controller;

      this.amazonService.get<string>(
        url,
        referer,
        {
          onSuccess: (res) => this.onSuccess(res, price),
          onError: (e) => this.onError(e, price, ad, prices, resolveAd),
        },
        controller.signal
      );
    })
      .then((failed) => {
        price.pending = false;
        price.complete = true;
        if (!failed) this.amazonService.queueService.completed++;
        this.tryComplete(ad, prices, resolveAd);
      })
      .catch(() => {
        price.pending = false;
        price.failed++;
        this.amazonService.queueService.failed++;
        this.retry(price, ad, prices, resolveAd);
      });
  }

  private async onSuccess(data: string, price: AmazonAdPrice) {
    if (!data.length) {
      price.reject?.("Received empty data");
      return;
    }

    const { document } = parseHTML(data);
    const pdpAd = this.builder.build(document);

    if (pdpAd?.isCaptcha) {
      price.reject?.("Captcha occured");
      return;
    }

    if (pdpAd?.dispatchFrom && pdpAd.dispatchFrom !== "Amazon") {
      price.resolve?.();
      return;
    }

    if (!pdpAd?.dispatchFrom && price.failed < 2) {
      price.reject?.("dispatchFrom not found");
      return;
    }

    price.value = pdpAd?.price;
    price.resolve?.();
  }

  private onError(
    e: any,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    if (e.status === 404) {
      this.tryDelete(ad, price, prices, resolveAd);
      return;
    }

    if (price.failed > 200) {
      price.resolve?.(true);
      return;
    }

    price.reject?.("Failed");
  }
}
