export interface AmazonAdCategory {
  id: number;
  name: string;
}

export interface AmazonPlpAd {
  asin: string;
  category: string;
  price?: number;
}

export interface AmazonPdpAd {
  asin: string;
  price: string;
}
