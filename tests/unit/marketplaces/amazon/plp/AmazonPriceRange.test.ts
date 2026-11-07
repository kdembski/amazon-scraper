import { describe, expect, it } from "vitest";
import { AmazonPriceRange } from "@/marketplaces/amazon/plp/AmazonPriceRange";

const range = (min: number, max?: number) => new AmazonPriceRange(min, max);

describe("AmazonPriceRange", () => {
  it.each([
    ["-999", range(0, 999)],
    ["1000-1999", range(1000, 1999)],
    ["500000-", range(500000)],
  ])("parses %s", (value, parsed) => {
    expect(AmazonPriceRange.parse(value)).toEqual(parsed);
  });

  it("splits a closed range in the middle", () => {
    expect(range(1000, 1999).split()).toEqual([range(1000, 1499), range(1500, 1999)]);
  });

  it("splits a range of two grosze into single grosze", () => {
    expect(range(5, 6).split()).toEqual([range(5, 5), range(6, 6)]);
  });

  it("splits an open range at double its minimum", () => {
    expect(range(500000).split()).toEqual([range(500000, 999999), range(1000000)]);
  });

  it.each([[0], [100000000], [200000000]])("does not split the open range from %d", (min) => {
    expect(range(min).split()).toBeUndefined();
  });

  it("splits the open range just below a million zloty", () => {
    expect(range(99999999).split()).toEqual([range(99999999, 199999997), range(199999998)]);
  });

  it("does not split a single grosz", () => {
    expect(range(7, 7).split()).toBeUndefined();
  });

  it.each([
    [range(0, 999), "p_36%3A-999"],
    [range(1000, 1499), "p_36%3A1000-1499"],
    [range(1000000), "p_36%3A1000000-"],
  ])("formats %o as %s", (value, filter) => {
    expect(value.toFilter()).toBe(filter);
  });
});
