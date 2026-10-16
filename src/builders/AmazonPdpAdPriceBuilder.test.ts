import { describe, expect, it } from "vitest";
import { AmazonPdpAdPriceBuilder } from "@/builders/AmazonPdpAdPriceBuilder";
import { aPrice, toDocument } from "@/__fixtures__/html";

const builder = new AmazonPdpAdPriceBuilder();
const build = (body: string) => builder.build(toDocument(body));

const textPrice = (value: string, size?: string) => `
  <span class="a-price a-text-price"${size ? ` data-a-size="${size}"` : ""}>
    <span class="a-offscreen"></span>
    <span aria-hidden="true">${value}</span>
  </span>
`;

const offscreenPrice = (value: string) => `
  <div id="corePrice_feature_div">
    <span class="a-price"><span class="a-offscreen">${value}</span></span>
  </div>
`;

describe("AmazonPdpAdPriceBuilder", () => {
  it("returns undefined when the page has no price", () => {
    expect(build(`<div id="dp"></div>`)).toBeUndefined();
  });

  it.each([["desktop"], ["mobile"]])(
    "reads whole and fraction from corePriceDisplay_%s",
    (id) => {
      const body = `
        <div id="corePriceDisplay_${id}_feature_div">${aPrice("49", "99")}</div>
      `;
      expect(build(body)).toBe(49.99);
    }
  );

  it("reads .a-offscreen alone", () => {
    expect(build(offscreenPrice("19,90 zł"))).toBe(19.9);
  });

  it("reads .aok-offscreen alone", () => {
    const body = `
      <div id="corePriceDisplay_desktop_feature_div">
        <span class="aok-offscreen">7,49 €</span>
      </div>
    `;
    expect(build(body)).toBe(7.49);
  });

  it("ignores .aok-offscreen marked as mini", () => {
    const body = `
      <div id="corePriceDisplay_desktop_feature_div">
        <span class="aok-offscreen a-size-mini">7,49 €</span>
      </div>
    `;
    expect(build(body)).toBeUndefined();
  });

  it("reads the text price from corePrice_desktop", () => {
    const body = `<div id="corePrice_desktop">${textPrice("29,99 €")}</div>`;
    expect(build(body)).toBe(29.99);
  });

  it.each([["mini"], ["s"]])(
    "ignores text prices of size %s (e.g. unit or list price)",
    (size) => {
      const body = `<div id="corePrice_desktop">${textPrice("29,99 €", size)}</div>`;
      expect(build(body)).toBeUndefined();
    }
  );

  it("reads the selected swatch price", () => {
    const body = `
      <div id="tmmSwatches">
        <div class="swatchElement"><span class="a-color-price">9,99 €</span></div>
        <div class="swatchElement selected"><span class="a-color-price">14,99 €</span></div>
      </div>
    `;
    expect(build(body)).toBe(14.99);
  });

  it("picks the price that occurs most often", () => {
    const body = `
      <div id="corePriceDisplay_desktop_feature_div">
        ${aPrice("49", "99", "49,99 €")}
        <span class="aok-offscreen">49,99 €</span>
      </div>
      <div id="tmmSwatches">
        <div class="swatchElement selected"><span class="a-color-price">59,99 €</span></div>
      </div>
    `;
    expect(build(body)).toBe(49.99);
  });

  it.each([
    ["1.299,00 €", 1299],
    ["12,99 zł", 12.99],
    ["199,00 kr", 199],
    ["€ 5,5", 5.5],
  ])("parses EU formatted %s", (value, expected) => {
    expect(build(offscreenPrice(value))).toBe(expected);
  });

  it("treats a dot as a thousands separator (only EU format is supported)", () => {
    expect(build(offscreenPrice("£12.99"))).toBe(1299);
  });
});
