import { AmazonPdpCountryScraper } from "@/scrapers/amazon/abstract/AmazonPdpCountryScraper";
import { PlaywrightService } from "@/services/PlaywrightService";
import { AmazonAd, Country, AmazonAdPrice } from "@/types/amazon.types";
import { PlaywrightItem } from "@/types/playwright.types";
import { parseHTML } from "linkedom";
import { Page } from "playwright";

export class HeadlessAmazonPdpCountryScraper extends AmazonPdpCountryScraper {
  private playwrightService;

  constructor(playwrightService = PlaywrightService.getInstance()) {
    super();
    this.playwrightService = playwrightService;
  }

  async execute(
    country: Country,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    const price = this.priceHelper.getPrice(prices, country.id);
    if (!price) return;

    new Promise<boolean | undefined>((resolvePrice, rejectPrice) => {
      if (price.complete || price.deleted || price.pending) return;

      price.resolve = resolvePrice;
      price.reject = rejectPrice;

      price.pending = true;
      const { url, referer } = this.builder.buildUrl(country, ad);

      this.playwrightService
        .create(url, referer)
        .then(async (item) => {
          if (price.deleted) {
            item.close();
            return;
          }

          setTimeout(() => {
            if (item.page.isClosed()) return;
            item.close();
            price.reject?.("Page blocked");
          }, 5 * 60 * 1000);

          if (item.isSuccess()) {
            this.success(item, country, price).catch((e) => price.reject?.(e));
            return;
          }

          this.error(item, price, ad, prices, resolveAd);
        })
        .catch((e) => price.reject?.(e));
    })
      .then(() => {
        price.complete = true;
        price.pending = false;
        this.playwrightService.completed++;
        this.tryComplete(ad, prices, resolveAd);
      })
      .catch(() => {
        price.pending = false;
        price.failed++;
        this.playwrightService.failed++;
        this.retry(country, ad, prices, resolveAd);
      });
  }

  private async success(
    item: PlaywrightItem,
    country: Country,
    price: AmazonAdPrice
  ) {
    await this.waitForBody(item.page);
    await this.handleCaptcha(item);

    await this.changeDelivery(item, country);
    await this.waitForBody(item.page);

    await this.handleCaptcha(item);
    await this.waitForProduct(item.page);

    const html = await item.page.content();
    const { document } = parseHTML(html);
    const pdpAd = this.builder.build(document);

    price.value = pdpAd?.price;
    item.close();
    price.resolve?.();
  }

  private async handleCaptcha(item: PlaywrightItem) {
    if (!(await item.isCaptcha())) return;
    this.playwrightService.captcha++;
    item.close();
    throw "Captcha occured";
  }

  private error(
    item: PlaywrightItem,
    price: AmazonAdPrice,
    ad: AmazonAd,
    prices: AmazonAdPrice[],
    resolveAd: () => void
  ) {
    if (item.is404()) {
      this.tryDelete(ad, price, prices, resolveAd);
      item.close();
      return;
    }

    if (price.failed > 50) {
      item.close();
      throw "Failed over 10 times";
    }

    item.close();
    throw "Failed";
  }

  private async waitForProduct(page: Page) {
    await page.waitForSelector("#title_feature_div");
    await page.waitForTimeout(100);
  }

  private async waitForBody(page: Page) {
    await page.waitForSelector("body");
    await page.waitForTimeout(100);
  }

  private async changeDelivery(
    { page, close }: PlaywrightItem,
    country: Country
  ) {
    if (page.isClosed()) throw "Page is closed";
    if (country.code === "pl" || country.code === "se") return;

    await page.waitForSelector("#nav-global-location-data-modal-action");
    await page.waitForTimeout(100);

    await page.locator("#nav-global-location-data-modal-action").click();
    await page.waitForSelector("#Condo");
    await page.waitForTimeout(100);

    if (!(await page.isVisible("#GLUXCountryList"))) {
      close();
      throw "Country list select not found";
    }

    await page.waitForLoadState("load");
    await page.locator("#GLUXCountryList").selectOption({ value: "PL" });
    await page
      .locator(`.a-popover-header button[data-action="a-popover-close"]`)
      .click();
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "commit" });
  }
}
