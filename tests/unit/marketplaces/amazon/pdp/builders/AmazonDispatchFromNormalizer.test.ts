import { describe, expect, it } from "vitest";
import { AmazonDispatchFromNormalizer } from "@/marketplaces/amazon/pdp/builders/AmazonDispatchFromNormalizer";

const normalizer = new AmazonDispatchFromNormalizer();

describe("AmazonDispatchFromNormalizer", () => {
  it("collapses whitespace", () => {
    expect(normalizer.normalize("  Some \n  Seller ")).toBe("Some Seller");
  });

  it("names Amazon by its domain plain Amazon", () => {
    expect(normalizer.normalize("Amazon.nl")).toBe("Amazon");
    expect(normalizer.normalize("amazon.com.be")).toBe("Amazon");
  });

  it("keeps other sellers", () => {
    expect(normalizer.normalize("Some Seller")).toBe("Some Seller");
  });

  it("gives nothing for an empty value", () => {
    expect(normalizer.normalize("  ")).toBeUndefined();
    expect(normalizer.normalize(undefined)).toBeUndefined();
  });
});
