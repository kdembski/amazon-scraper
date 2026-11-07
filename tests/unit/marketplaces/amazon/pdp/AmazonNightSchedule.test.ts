import { describe, expect, it } from "vitest";
import { AmazonNightSchedule } from "@/marketplaces/amazon/pdp/AmazonNightSchedule";

describe("AmazonNightSchedule", () => {
  it.each([
    ["2026-01-15T21:59:00Z", false],
    ["2026-01-15T22:00:00Z", true],
    ["2026-01-15T05:59:00Z", true],
    ["2026-01-15T06:00:00Z", false],
    ["2026-07-15T20:59:00Z", false],
    ["2026-07-15T21:00:00Z", true],
    ["2026-07-15T04:59:00Z", true],
    ["2026-07-15T05:00:00Z", false],
  ])("at %s is night: %s", (iso, night) => {
    expect(new AmazonNightSchedule(() => new Date(iso)).isNight()).toBe(night);
  });
});
