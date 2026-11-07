import { vi } from "vitest";
import type { AmazonService } from "@/marketplaces/amazon/AmazonService";
import type { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import type { AmazonPlpAdSender } from "@/marketplaces/amazon/plp/AmazonPlpAdSender";
import type { ApiService } from "@/shared/backend/ApiService";
import type { ScraperConfigService } from "@/shared/backend/ScraperConfigService";
import type { AmazonCountryService } from "@/marketplaces/amazon/AmazonCountryService";
import type { StopAt } from "@/shared/http/http.types";
import type { TokenBucketQueue } from "@/shared/http/TokenBucketQueue";
import type { AmazonAdBuilder, AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";

export function fakeApiService() {
  const get = vi.fn();
  const send = vi.fn().mockResolvedValue(undefined);
  const service = { get, send } as unknown as ApiService;
  return { service, get, send };
}

export function fakeAmazonPdpResultSender() {
  const prices = vi.fn();
  const deleted = vi.fn();
  const service = { prices, deleted } as unknown as AmazonPdpResultSender;
  return { service, prices, deleted };
}

export function fakeAmazonPlpAdSender() {
  const add = vi.fn();
  const service = { add } as unknown as AmazonPlpAdSender;
  return { service, add };
}

export function fakeAmazonCountryService() {
  const getCountries = vi.fn().mockResolvedValue([]);
  const service = { getCountries } as unknown as AmazonCountryService;
  return { service, getCountries };
}

type FakeRequest = {
  url: string;
  referer: string;
  options: { proxyType?: string; stopAt?: StopAt; isCancelled?: () => boolean };
  resolve: (data: string) => void;
  reject: (e: any) => void;
};

// Records every request so a test can answer it with respond() / fail()
export function fakeAmazonService() {
  const requests: FakeRequest[] = [];
  const get = vi.fn((url: string, referer: string, options: FakeRequest["options"] = {}) => {
    return new Promise<string>((resolve, reject) => {
      requests.push({ url, referer, options, resolve, reject });
    });
  });
  const service = { get } as unknown as AmazonService;

  const respond = (index: number, data: string) => requests[index].resolve(data);
  const fail = (index: number, error: any = new Error("Network error")) => {
    requests[index].reject(error);
  };

  return { service, get, requests, respond, fail };
}

export function fakeTokenBucketQueue() {
  const queue = [] as Function[];
  const service = { queue } as unknown as TokenBucketQueue;
  return { service, queue };
}

export function fakeScraperConfigService({ batchSize = 50 } = {}) {
  const get = vi.fn(() => ({ concurrency: 10, rps: 0, batchSize }));
  const service = { get } as unknown as ScraperConfigService;
  return { service, get };
}

export function fakeAdBuilder(result: AmazonAdBuildResult = {}) {
  const build = vi.fn(() => result);
  const buildUrl = vi.fn((country: { tld: string }, ad: { asin: string }) => ({
    url: `${country.tld}/dp/${ad.asin}`,
    referer: `${country.tld}/ref`,
  }));
  const trimHtml = vi.fn((html: string) => html);
  const builder: AmazonAdBuilder = { trimHtml, build, buildUrl };
  return { builder, trimHtml, build, buildUrl };
}
