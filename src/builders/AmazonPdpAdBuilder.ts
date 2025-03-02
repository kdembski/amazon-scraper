import { AmazonPdpAdPriceBuilder } from "@/builders/AmazonPdpAdPriceBuilder";

export class AmazonPdpAdBuilder {
  private priceBuilder;

  constructor(priceBuilder = new AmazonPdpAdPriceBuilder()) {
    this.priceBuilder = priceBuilder;
  }

  build(document: Document) {
    const form = document.querySelector("form");
    const isCaptcha =
      form?.getAttribute("action") === "/errors/validateCaptcha";

    if (isCaptcha) {
      console.warn("Warning: Captcha triggered!");
      return;
    }

    const delivery = this.getDelivery(document);
    const deliverCode = this.getDeliveryCode(delivery);
    const price = this.priceBuilder.build(document);
    const asin = this.getAsin(document);

    return {
      price,
      asin,
      isCaptcha,
      deliverCode,
    };
  }

  private getAsin(document: Document) {
    const els = document.querySelectorAll(`[data-csa-c-asin]`);
    const asins = [...els]
      .map((el) => el.getAttribute("data-csa-c-asin"))
      .filter((asin): asin is string => !!asin);

    return asins[0];
  }

  private getDelivery(document: Document) {
    const desktop = document
      .querySelector(`#glow-ingress-line2`)
      ?.textContent?.replace(/\s/g, "");

    const mobile = document
      .querySelector(`#glow-ingress-single-line`)
      ?.textContent?.match(/[A-Za-z]+(?=\s⌵)/)?.[0];

    return desktop || mobile;
  }

  getDeliveryCode(name?: string) {
    if (!name) return;
    if (["Canada", "Kanada"].includes(name)) return "ca";
    if (["Germania", "Allemagne"].includes(name)) return "de";
  }
}
