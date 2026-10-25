import {
  AmazonAd,
  AmazonAdPrice,
  AmazonPlpAdPage,
} from "@/marketplaces/amazon/types/amazon.types";
import { AmazonCountry } from "@/marketplaces/amazon/types/amazon.types";

export const buildAmazonCountry = (overrides: Partial<AmazonCountry> = {}): AmazonCountry => ({
  countryId: 1,
  tld: "de",
  proxyType: "datacenter",
  ...overrides,
});

export const buildAd = (overrides: Partial<AmazonAd> = {}): AmazonAd => ({
  id: 1,
  asin: "B0TESTASIN",
  ...overrides,
});

export const buildPrice = (
  overrides: Partial<AmazonAdPrice> = {}
): AmazonAdPrice => ({
  country: buildAmazonCountry(),
  complete: false,
  deleted: false,
  failed: 0,
  ...overrides,
});

// One price per country, with countryIds and tlds 1..count
export const buildPrices = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    buildPrice({ country: buildAmazonCountry({ countryId: i + 1, tld: `c${i + 1}` }) })
  );

export const buildPlpPage = (
  overrides: Partial<AmazonPlpAdPage> = {}
): AmazonPlpAdPage => ({
  category: "electronics",
  allPages: false,
  pending: false,
  complete: false,
  failed: 0,
  visited: new Set(),
  number: 1,
  ...overrides,
});
