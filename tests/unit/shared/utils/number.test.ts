import { describe, expect, it } from "vitest";
import { calculateAvg, roundToTwoDecimals } from "@/shared/utils/number";

describe("calculateAvg", () => {
  it("returns 0 for an empty array", () => {
    expect(calculateAvg([])).toBe(0);
  });

  it("returns the arithmetic mean", () => {
    expect(calculateAvg([1, 2, 3, 6])).toBe(3);
  });
});

describe("roundToTwoDecimals", () => {
  it("formats a number with two decimals", () => {
    expect(roundToTwoDecimals(1.005)).toBe("1.00");
    expect(roundToTwoDecimals(2.346)).toBe("2.35");
    expect(roundToTwoDecimals(3)).toBe("3.00");
  });

  it("keeps zero", () => {
    expect(roundToTwoDecimals(0)).toBe("0.00");
  });

  it("returns a dash for a missing value", () => {
    expect(roundToTwoDecimals(undefined)).toBe("-");
  });
});
