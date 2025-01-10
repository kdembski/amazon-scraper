export interface OlxAdCategory {
  id: number;
  name: string;
}

export interface OlxPlpAd {
  olxId: string;
  name: string;
  price: number;
  url: string;
  categoryName: string;
}

export interface OlxPdpAd {
  olxUserId: string;
}
