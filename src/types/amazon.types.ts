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
  resolve?: (value?: AmazonPlpAd[] | PromiseLike<AmazonPlpAd[]>) => void;
  reject?: (e: any) => void;
}
export interface AmazonPlpAdPageSort {
  min: number;
  max?: number;
}

export interface AmazonPdpAd {
  price?: number;
  asin?: string;
}

export interface AmazonAd {
  id: number;
  asin: string;
  controller?: AbortController;
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
  controller?: AbortController;
  resolve?: (failed?: boolean) => void;
  reject?: (e: any) => void;
}

export interface Country {
  id: number;
  name: string;
  code: string;
  currencyId: number;
  active: boolean;
}
