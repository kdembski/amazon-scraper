import { AmazonPlpAd } from "@/types/amazon.types";

export class AmazonPlpAdBuilder {
  private _ad?: AmazonPlpAd;

  build(item: Element, category: string) {
    const asin = item.getAttribute("data-asin");
    const price = item
      .querySelector("span.a-price-whole")
      ?.textContent?.replace(/\s/g, "");

    if (!asin) return this;

    this._ad = {
      asin,
      category,
      price: price ? parseInt(price) : undefined,
    };

    return this;
  }

  get ad() {
    return this._ad;
  }
}
