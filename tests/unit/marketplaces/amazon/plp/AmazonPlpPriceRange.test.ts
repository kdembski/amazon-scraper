import { describe, expect, it } from "vitest";
import {
  parsePriceRange,
  splitPriceRange,
  toPriceFilter,
} from "@/marketplaces/amazon/plp/AmazonPlpPriceRange";

describe("AmazonPlpPriceRange", () => {
  it.each([
    ["-999", { min: 0, max: 999 }],
    ["1000-1999", { min: 1000, max: 1999 }],
    ["500000-", { min: 500000 }],
  ])("parses %s", (value, range) => {
    expect(parsePriceRange(value)).toEqual(range);
  });

  it("splits a closed range in the middle", () => {
    expect(splitPriceRange({ min: 1000, max: 1999 })).toEqual([
      { min: 1000, max: 1499 },
      { min: 1500, max: 1999 },
    ]);
  });

  it("splits a range of two grosze into single grosze", () => {
    expect(splitPriceRange({ min: 5, max: 6 })).toEqual([
      { min: 5, max: 5 },
      { min: 6, max: 6 },
    ]);
  });

  it("splits an open range at double its minimum", () => {
    expect(splitPriceRange({ min: 500000 })).toEqual([
      { min: 500000, max: 999999 },
      { min: 1000000 },
    ]);
  });

  it("does not split a single grosz", () => {
    expect(splitPriceRange({ min: 7, max: 7 })).toBeUndefined();
  });

  it.each([
    [{ min: 0, max: 999 }, "p_36%3A-999"],
    [{ min: 1000, max: 1499 }, "p_36%3A1000-1499"],
    [{ min: 1000000 }, "p_36%3A1000000-"],
  ])("formats %o as %s", (range, filter) => {
    expect(toPriceFilter(range)).toBe(filter);
  });
});
