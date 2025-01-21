import { parseHTML } from "linkedom";
import { AmazonPlpAd } from "../types/amazon.types";
import { ApiService } from "../ApiService";
import { AmazonPlpAdBuilder } from "./AmazonPlpAdBuilder";
import { AmazonService } from "./AmazonService";

export class AmazonPlpScraper {
  private baseUrl = "https://www.amazon.pl/";
  private apiService;
  private amazonService;
  private builder;
  private sorts = [
    "exact-aware-popularity-rank",
    "date-desc-rank",
    "review-rank",
  ];

  constructor(
    apiService = ApiService.getInstance(),
    amazonService = AmazonService.getInstance(),
    builder = new AmazonPlpAdBuilder()
  ) {
    this.apiService = apiService;
    this.amazonService = amazonService;
    this.builder = builder;
  }

  async executeMultiple(category: string, pages: number) {
    for (let i = 1; i <= pages; i++) {
      this.execute(category, i);
    }
  }

  async execute(category: string, page: number) {
    this.sorts.forEach((sort) => {
      const url = `${this.baseUrl}s?i=${category}&s=${sort}&page=${page}`;

      this.amazonService.get<string>(url, {
        onSuccess: (data) => this.onSuccess(data, category, page),
        onError: () => this.onError(category, page),
      });
    });
  }

  private onSuccess(data: string, category: string, page: number) {
    const listItemSelector = "div[role='listitem']";
    const { document } = parseHTML(data);
    const items = [...document.querySelectorAll(listItemSelector)];

    const ads = items.reduce((accum: AmazonPlpAd[], item) => {
      this.builder.build(item, category);
      if (!this.builder.ad) return accum;

      accum.push(this.builder.ad);
      return accum;
    }, []);

    if (ads.length === 0) {
      this.execute(category, page);
      return;
    }

    this.apiService.post("amazon/ads", ads);
  }

  private onError(category: string, page: number) {
    this.execute(category, page);
  }
}
