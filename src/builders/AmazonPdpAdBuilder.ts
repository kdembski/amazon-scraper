import { AmazonPdpAd } from "@/types/amazon.types";

export class AmazonPdpAdBuilder {
  private _ad?: AmazonPdpAd;
  private _isCaptcha?: boolean;

  build(document: Document) {
    const form = document.querySelector("form");
    const isCaptcha =
      form?.getAttribute("action") === "/errors/validateCaptcha";

    this._isCaptcha = isCaptcha;

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
      return this;
    }

    const price = this.getPrice(document);
    const asin = this.getAsin(document);

    this._ad = {
      price,
      asin,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }

  get isCaptcha() {
    return this._isCaptcha;
  }

  private getPrice(document: Document) {
    return (
      this.getCorePrice(document, "desktop") ||
      this.getCorePrice(document, "mobile")
    );
  }

  private getCorePrice(document: Document, id: string) {
    const container = document.querySelector(
      `#corePriceDisplay_${id}_feature_div`
    );

    const whole = container
      ?.querySelector(".a-price-whole")
      ?.textContent?.replace(/[^\d]/g, "");

    const fraction = container
      ?.querySelector(".a-price-fraction")
      ?.textContent?.replace(/[^\d]/g, "");

    if (!whole || !fraction) return;

    const value = `${whole}.${fraction}`;
    return parseFloat(value);
  }

  private getAsin(document: Document) {
    const els = document.querySelectorAll(`[data-csa-c-asin]`);
    const asins = [...els]
      .map((el) => el.getAttribute("data-csa-c-asin"))
      .filter((asin): asin is string => !!asin);

    return asins[0];
  }
}
