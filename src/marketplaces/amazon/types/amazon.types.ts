import type { Document } from "domhandler";
import type { StopAt } from "@/shared/http/http.types";

export interface AmazonCountryRoute {
  id: number;
  priority: number;
  proxyType: string;
  pdpSource: string;
  maxAttempts: number;
}

export interface AmazonCountry {
  countryId: number;
  tld: string;
  active: boolean;
  routes: AmazonCountryRoute[];
}

export interface AmazonAdCategory {
  id: number;
  name: string;
  scrapedAt: string | null;
}

export interface AmazonPlpAd {
  asin: string;
  name: string;
  image: string;
  categoryName: string;
}

export interface AmazonAd {
  id: number;
  asin: string;
  skipRouteIds?: number[];
}

export interface AmazonAdBuildResult {
  price?: number;
  dispatchFrom?: string;
  // False when the response is not the page we requested (e.g. bot challenge)
  isValid?: boolean;
}

export interface AmazonAdBuilder {
  // Markers that must arrive in this order; the response is not needed past the last one
  stopAt?: StopAt;
  // A 404 means only that this source has no data, not that the product is gone
  notFoundIsNoData?: boolean;
  trimHtml(html: string): string;
  build(document: Document): AmazonAdBuildResult;
  buildUrl(country: AmazonCountry, ad: AmazonAd): { url: string; referer: string };
}

export interface AmazonPdpPrice {
  adId: number;
  countryId: number;
  value?: number;
  dispatchFrom?: string;
}
