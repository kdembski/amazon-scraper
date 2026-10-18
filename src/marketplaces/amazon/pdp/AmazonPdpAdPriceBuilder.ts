import _ from "lodash";

export class AmazonPdpAdPriceBuilder {
  build(document: Document) {
    const prices = [
      ...this.getCorePriceDisplayFeatureDiv(document, "desktop"),
      ...this.getCorePriceDisplayFeatureDiv(document, "mobile"),
      ...this.getCorePriceFeatureDiv(document),
      this.getCorePriceDesktop(document),
      this.getSwatchPrice(document),
    ].filter((price) => !!price);

    const freq = _.countBy(prices);
    const price = _.maxBy(Object.keys(freq), (o) => freq[o]);

    if (!price) return;
    return this.parse(price);
  }

  private getCorePriceDisplayFeatureDiv(document: Document, id: string) {
    const container = document.querySelector(
      `#corePriceDisplay_${id}_feature_div`
    );

    return [
      this.buildFractionPrice(container),
      this.buildAokOffscreenPrice(container),
      this.buildAOffscreenPrice(container),
      this.buildWholePrice(container),
    ];
  }

  private getCorePriceFeatureDiv(document: Document) {
    const container = document.querySelector(`#corePrice_feature_div`);

    return [
      this.buildFractionPrice(container),
      this.buildAokOffscreenPrice(container),
      this.buildAOffscreenPrice(container),
      this.buildWholePrice(container),
    ];
  }

  private getCorePriceDesktop(document: Document) {
    const container = document.querySelector(`#corePrice_desktop`);
    return this.buildWholePrice(container);
  }

  private getSwatchPrice(document: Document) {
    const container = document.querySelector(
      `#tmmSwatches .swatchElement.selected`
    );
    return this.buildColorPrice(container);
  }

  private buildWholePrice(el: Element | null) {
    const price = this.getPriceContent(
      el,
      `.a-text-price:not([data-a-size="mini"]):not([data-a-size="s"]) > span[aria-hidden="true"]`
    );
    if (!price) return;

    return this.parse(price);
  }

  private buildColorPrice(el: Element | null) {
    const price = this.getPriceContent(el, ".a-color-price");
    if (!price) return;

    return this.parse(price);
  }

  private buildAokOffscreenPrice(el: Element | null) {
    const price = this.getPriceContent(el, ".aok-offscreen:not(.a-size-mini)");
    if (!price) return;

    return this.parse(price);
  }

  private buildAOffscreenPrice(el: Element | null) {
    const price = this.getPriceContent(el, ".a-offscreen");
    if (!price) return;

    return this.parse(price);
  }

  private buildFractionPrice(el: Element | null) {
    const whole = this.getPriceContent(el, ".a-price .a-price-whole");
    const fraction = this.getPriceContent(el, ".a-price .a-price-fraction");

    if (!whole || !fraction) return;

    const value = `${whole}${fraction}`;
    return this.parse(value);
  }

  private getPriceContent(el: Element | null, selector: string) {
    return this.cleanUpPrice(el?.querySelector(selector)?.textContent);
  }

  private cleanUpPrice(price: string | null | undefined) {
    return price?.replace(/[^\d,]/g, "").replace(",", ".");
  }

  private parse(value: string) {
    return parseFloat(parseFloat(value).toFixed(2));
  }
}
