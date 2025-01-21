export interface AmazonAdCategory {
  id: number;
  name: string;
}

export interface AmazonPlpAd {
  asin: string;
  categoryName: string;
}

export interface AmazonPdpAd {
  price?: number;
}

export interface AmazonAd {
  id: number;
  asin: string;
}

export interface AmazonAdPrice {
  adId: number;
  currencyId: number;
  value?: number;
  pending: boolean;
  complete: boolean;
}

export interface Country {
  name: string;
  code: string;
  currencyId: number;
}
