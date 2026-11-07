import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmazonPageReader } from "@/marketplaces/amazon/AmazonPageReader";
import type { MetricsService } from "@/shared/metrics/MetricsService";
import { find } from "@/shared/utils/html";
import { botWallPage, captchaPage, interstitialPage } from "@@tests/support/html";

const setup = (parseFailure: "parse_error" | "invalid" = "parse_error") => {
  const increment = vi.fn();
  const reader = new AmazonPageReader("pdp", parseFailure, { increment } as unknown as MetricsService);
  const build = vi.fn((): { isValid?: boolean; price?: number } => ({ isValid: true, price: 10 }));
  const read = (html: string, trim?: (html: string) => string) =>
    reader.read(html, { country: "de", trim, build, hasData: (page) => !!page.price });
  const counted = () => increment.mock.calls.map(([metric, labels]) => [metric, labels.country, labels.outcome]);

  return { read, build, counted };
};

describe("AmazonPageReader", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the built page and counts it as data", () => {
    const { read, counted } = setup();

    expect(read("<div></div>")).toEqual({ isValid: true, price: 10 });
    expect(counted()).toEqual([["responses", "de", "data"]]);
  });

  it("counts a page without data as no_data and still returns it", () => {
    const { read, build, counted } = setup();
    build.mockReturnValue({ isValid: true });

    expect(read("<div></div>")).toEqual({ isValid: true });
    expect(counted()).toEqual([["responses", "de", "no_data"]]);
  });

  it("builds from the trimmed html", () => {
    const { read, build } = setup();

    read("<a></a><b></b>", () => '<i id="x"></i>');

    expect(find("#x", (build.mock.calls[0] as unknown[])[0] as never)).toBeTruthy();
  });

  it("counts an empty response without building", () => {
    const { read, build, counted } = setup();

    expect(read("")).toBeUndefined();
    expect(build).not.toHaveBeenCalled();
    expect(counted()).toEqual([["responses", "de", "empty"]]);
  });

  it.each([captchaPage, botWallPage, interstitialPage])("counts a captcha without building: %#", (page) => {
    const { read, build, counted } = setup();

    expect(read(page)).toBeUndefined();
    expect(build).not.toHaveBeenCalled();
    expect(counted()).toEqual([["responses", "de", "captcha"]]);
  });

  it("counts an invalid page", () => {
    const { read, build, counted } = setup();
    build.mockReturnValue({ isValid: false });

    expect(read("<div></div>")).toBeUndefined();
    expect(counted()).toEqual([["responses", "de", "invalid"]]);
  });

  it.each(["parse_error", "invalid"] as const)("counts a parse failure as %s", (parseFailure) => {
    const { read, build, counted } = setup(parseFailure);
    build.mockImplementation(() => {
      throw new Error("broken");
    });

    expect(read("<div></div>")).toBeUndefined();
    expect(counted()).toEqual([["responses", "de", parseFailure]]);
    expect(console.error).toHaveBeenCalledWith("pdp: parse failed", expect.any(Error));
  });

  it("counts a failing trim as a parse failure", () => {
    const { read, counted } = setup();

    const result = read("<div></div>", () => {
      throw new Error("broken");
    });

    expect(result).toBeUndefined();
    expect(counted()).toEqual([["responses", "de", "parse_error"]]);
  });
});
