import type { ScrapingRequest } from "@/shared/http/http.types";
import { ScrapingClient } from "@/shared/http/ScrapingClient";

export class AmazonService {
  private static instance: AmazonService;
  private baseUrl = "https://www.amazon.";

  private constructor(private scrapingClient = ScrapingClient.getInstance()) {}

  public static getInstance(): AmazonService {
    if (!AmazonService.instance) {
      AmazonService.instance = new AmazonService();
    }

    return AmazonService.instance;
  }

  get queueService() {
    return this.scrapingClient.queueService;
  }

  get<T>(url: string, referer: string, request: Omit<ScrapingRequest, "referer" | "labels"> = {}) {
    return this.scrapingClient.get<T>(`${this.baseUrl}${url}`, {
      ...request,
      referer: `${this.baseUrl}${referer}`,
      labels: { country: url.split("/")[0] },
    });
  }
}
