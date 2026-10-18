import {
  AmazonAd,
  AmazonAdPrice,
  AmazonPlpAdPage,
  Country,
} from "@/types/amazon.types";

export const buildCountry = (overrides: Partial<Country> = {}): Country => ({
  id: 1,
  name: "Germany",
  code: "de",
  currencyId: 1,
  active: true,
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
  country: buildCountry(),
  pending: false,
  complete: false,
  deleted: false,
  adDeleted: false,
  failed: 0,
  ...overrides,
});

// One price per country, with ids and codes 1..count
export const buildPrices = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    buildPrice({ country: buildCountry({ id: i + 1, code: `c${i + 1}` }) })
  );

export const buildPlpPage = (
  overrides: Partial<AmazonPlpAdPage> = {}
): AmazonPlpAdPage => ({
  category: "electronics",
  pending: false,
  complete: false,
  failed: 0,
  visited: new Set(),
  number: 1,
  ...overrides,
});
