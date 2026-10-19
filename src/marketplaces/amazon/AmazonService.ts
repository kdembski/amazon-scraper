import { ScrapingClient } from "@/shared/http/ScrapingClient";

export class AmazonService {
  private static instance: AmazonService;
  private baseUrl = "https://www.amazon.";
  private scrapingClient;

  private constructor(scrapingClient = ScrapingClient.getInstance()) {
    this.scrapingClient = scrapingClient;
  }

  public static getInstance(): AmazonService {
    if (!AmazonService.instance) {
      AmazonService.instance = new AmazonService();
    }

    return AmazonService.instance;
  }

  get queueService() {
    return this.scrapingClient.queueService;
  }

  get<T>(
    url: string,
    referer?: string,
    callback?: {
      onSuccess?: (data: T) => void;
      onError?: (e: any) => void;
    }
  ) {
    this.scrapingClient.get<T>(
      `${this.baseUrl}${url}`,
      `${this.baseUrl}${referer}`,
      callback,
      { country: url.split("/")[0] }
    );
  }
}
