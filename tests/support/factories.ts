import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { AmazonAd, AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";

export const buildAmazonCountry = (overrides: Partial<AmazonCountry> = {}): AmazonCountry => ({
  countryId: 1,
  tld: "de",
  active: true,
  proxyType: "datacenter",
  pdpSource: "aod",
  priority: 0,
  ...overrides,
});

export const buildAd = (overrides: Partial<AmazonAd> = {}): AmazonAd => ({
  id: 1,
  asin: "B0TESTASIN",
  ...overrides,
});

export const buildPrice = (overrides: Partial<AmazonCountryPrice> = {}) =>
  Object.assign(new AmazonCountryPrice(buildAmazonCountry()), overrides);
