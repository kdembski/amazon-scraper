import { AmazonCountryPrice } from "@/marketplaces/amazon/pdp/AmazonCountryPrice";
import { AmazonAd, AmazonCountry, AmazonCountryRoute } from "@/marketplaces/amazon/types/amazon.types";

export const buildRoute = (overrides: Partial<AmazonCountryRoute> = {}): AmazonCountryRoute => ({
  id: 1,
  priority: 0,
  proxyType: "datacenter",
  pdpSource: "aod",
  maxAttempts: 6,
  ...overrides,
});

// Route fields build the single route (id = countryId) unless routes are given
type CountryOverrides = Partial<AmazonCountry> & Partial<Omit<AmazonCountryRoute, "id">>;

export const buildAmazonCountry = (overrides: CountryOverrides = {}): AmazonCountry => {
  const { countryId = 1, tld = "de", active = true, routes, ...route } = overrides;
  return { countryId, tld, active, routes: routes ?? [buildRoute({ id: countryId, ...route })] };
};

export const buildAd = (overrides: Partial<AmazonAd> = {}): AmazonAd => ({
  id: 1,
  asin: "B0TESTASIN",
  ...overrides,
});

export const buildPrice = ({ country = buildAmazonCountry(), ...overrides }: Partial<AmazonCountryPrice> = {}) =>
  Object.assign(new AmazonCountryPrice(country), overrides);
