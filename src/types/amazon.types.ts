import { PlaywrightItem } from "@/types/playwright.types";

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
  number: number;
  range: AmazonPlpAdPageSort;
  subcategory: string;
  pending: boolean;
  complete: boolean;
  failed: number;
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
}

export interface AmazonAdPrice {
  country: Country;
  value?: number;
  pending: boolean;
  complete: boolean;
  deleted: boolean;
  failed: number;
  resolve?: () => void;
  reject?: (e: any) => void;
}

export interface Country {
  id: number;
  name: string;
  code: string;
  currencyId: number;
}
