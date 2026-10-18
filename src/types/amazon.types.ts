export interface AmazonAdCategory {
  id: number;
  name: string;
}

export interface AmazonPlpAd {
  asin: string;
  name: string;
  image: string;
  categoryName: string;
}

export interface AmazonPlpAdPage {
  category: string;
  subcategory?: string;
  pending: boolean;
  complete: boolean;
  failed: number;
  visited: Set<string>;
  number: number;
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
  build(document: Document): AmazonAdBuildResult;
  buildUrl(country: Country, ad: AmazonAd): { url: string; referer: string };
}

export interface AmazonAdPrice {
  country: Country;
  value?: number;
  dispatchFrom?: string;
  pending: boolean;
  complete: boolean;
  deleted: boolean;
  adDeleted: boolean;
  failed: number;
  resolve?: () => void;
  reject?: (e: any) => void;
}

export interface Country {
  id: number;
  name: string;
  code: string;
  currencyId: number;
  active: boolean;
}
