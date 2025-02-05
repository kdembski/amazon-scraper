import { AmazonPdpAd } from "@/types/amazon.types";

export class AmazonPdpAdBuilder {
  private _ad?: AmazonPdpAd;

  build(document: Document) {
    const form = document.querySelector("form");
    const isCaptcha =
      form?.getAttribute("action") === "/errors/validateCaptcha";

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
    }

    const price = this.getPrice(document);

    this._ad = {
      price,
    };

    return this;
  }

  get ad() {
    return this._ad;
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
}
