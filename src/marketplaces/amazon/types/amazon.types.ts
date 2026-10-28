import type { Document } from "domhandler";

export interface AmazonCountry {
  countryId: number;
  tld: string;
  active: boolean;
  proxyType: string;
  pdpSource: string;
  priority: number;
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
}

export interface AmazonAdBuildResult {
  price?: number;
  dispatchFrom?: string;
  isCaptcha?: boolean;
  // False when the response is not the page we requested (e.g. bot challenge)
  isValid?: boolean;
}

export interface AmazonAdBuilder {
  // Markers that must arrive in this order; the response is not needed past the last one
  stopAt?: string[];
  // A 404 means only that this source has no data, not that the product is gone
  notFoundIsNoData?: boolean;
  trimHtml(html: string): string;
  build(document: Document): AmazonAdBuildResult;
  buildUrl(country: AmazonCountry, ad: AmazonAd): { url: string; referer: string };
}

export interface AmazonAdPrice {
  country: AmazonCountry;
  value?: number;
  dispatchFrom?: string;
  complete: boolean;
  deleted: boolean;
  failed: number;
  notFound: number;
}
