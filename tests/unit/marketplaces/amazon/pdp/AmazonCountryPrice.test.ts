import { describe, expect, it } from "vitest";
import { AmazonCountryPrice, NOT_FOUND_TO_DELETE } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { buildAmazonCountry, buildRoute } from "@@tests/support/factories";

const priceIn = (active = true) => new AmazonCountryPrice(buildAmazonCountry({ countryId: 4, active }));

const twoRoutes = () =>
  buildAmazonCountry({
    countryId: 4,
    routes: [
      buildRoute({ id: 10, priority: 1, pdpSource: "twister", maxAttempts: 8 }),
      buildRoute({ id: 20, priority: 3, maxAttempts: 3 }),
    ],
  });

describe("AmazonCountryPrice", () => {
  it("starts without a result", () => {
    const price = priceIn();

    expect(price.hasPrice).toBe(false);
    expect(price.complete).toBe(false);
    expect(price.retry.failed).toBe(0);
    expect(price.missingRouteIds).toEqual([]);
  });

  it("has a price only above 0", () => {
    const price = priceIn();

    price.setResult(0);
    expect(price.hasPrice).toBe(false);

    price.setResult(10, "Amazon");
    expect(price.hasPrice).toBe(true);
  });

  it("starts on the highest priority route with its maxAttempts", () => {
    const price = new AmazonCountryPrice(twoRoutes());

    expect(price.route?.id).toBe(20);
    expect(price.priorities).toEqual([3, 1]);
    for (let i = 0; i < 3; i++) price.retry.fail();
    expect(price.retry.isExhausted).toBe(true);
  });

  it("leaves out the routes to skip", () => {
    expect(new AmazonCountryPrice(twoRoutes(), [20]).route?.id).toBe(10);
    expect(new AmazonCountryPrice(twoRoutes(), [10, 20]).route).toBeUndefined();
  });

  it("is gone from an active country's route after NOT_FOUND_TO_DELETE 404s", () => {
    const price = priceIn();

    for (let i = 1; i < NOT_FOUND_TO_DELETE; i++) expect(price.registerNotFound()).toBe(false);
    expect(price.missingRouteIds).toEqual([]);

    expect(price.registerNotFound()).toBe(true);
    expect(price.missingRouteIds).toEqual([4]);
  });

  it("is gone from an inactive country's route after one 404", () => {
    const price = priceIn(false);

    expect(price.registerNotFound()).toBe(true);
    expect(price.missingRouteIds).toEqual([4]);
  });

  it("falls back only when the current route is missing and another is left", () => {
    const price = new AmazonCountryPrice(twoRoutes());
    expect(price.isFallingBack).toBe(false);

    price.markMissing();
    expect(price.isFallingBack).toBe(true);

    const single = priceIn();
    single.markMissing();
    expect(single.isFallingBack).toBe(false);
  });

  it("moves to the next route with fresh counters and keeps the attempts made", () => {
    const price = new AmazonCountryPrice(twoRoutes());
    price.retry.fail();
    price.registerNotFound();
    price.registerNotFound();

    price.nextRoute();

    expect(price.route?.id).toBe(10);
    expect(price.notFound).toBe(0);
    expect(price.retry.failed).toBe(0);
    expect(price.pastAttempts).toBe(2);
    expect(price.missingRouteIds).toEqual([20]);
    expect(price.isFallingBack).toBe(false);
    for (let i = 0; i < 7; i++) price.retry.fail();
    expect(price.retry.isExhausted).toBe(false);
  });

  it.each([
    ["deleted", true],
    ["data", false],
    ["given_up", false],
  ] as const)("finishes with %s", (outcome, deleted) => {
    const price = priceIn();

    price.finish(outcome);

    expect(price.complete).toBe(true);
    expect(price.deleted).toBe(deleted);
  });

  it("builds the price for the backend", () => {
    const price = priceIn();
    price.setResult(19.99, "Amazon");

    expect(price.toPdpPrice(7)).toEqual({ adId: 7, countryId: 4, value: 19.99, dispatchFrom: "Amazon" });
  });
});
