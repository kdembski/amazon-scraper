export interface AmazonCountry {
  countryId: number;
  tld: string;
  proxyType: string;
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

export interface AmazonPlpAdPage {
  category: string;
  allPages: boolean;
  subcategory?: string;
  pending: boolean;
  complete: boolean;
  failed: number;
  visited: Set<string>;
  number: number;
  price?: string;
  resolve?: (value?: AmazonPlpAd[] | PromiseLike<AmazonPlpAd[]>) => void;
  reject?: (e: any) => void;
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
}
