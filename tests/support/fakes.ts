import { vi } from "vitest";
import type { AmazonService } from "@/marketplaces/amazon/AmazonService";
import type { ApiService } from "@/shared/backend/ApiService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { AmazonCountryService } from "@/marketplaces/amazon/AmazonCountryService";
import type { AmazonAdBuilder, AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";

export function fakeApiService() {
  const get = vi.fn();
  const post = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockResolvedValue(undefined);
  const service = {
    get,
    post,
    put,
    delete: del,
  } as unknown as ApiService;
  return { service, get, post, put, delete: del };
}

export function fakeAmazonCountryService() {
  const getCountries = vi.fn().mockResolvedValue([]);
  const service = { getCountries } as unknown as AmazonCountryService;
  return { service, getCountries };
}

type GetCallback = {
  onSuccess?: (data: string) => void;
  onError?: (e: any) => void;
};

// Records every request so a test can answer it with respond() / fail()
export function fakeAmazonService() {
  const requests: { url: string; referer?: string; callback: GetCallback }[] =
    [];
  const queueService = { queue: [] as Function[] };
  const get = vi.fn((url: string, referer?: string, callback?: GetCallback) => {
    requests.push({ url, referer, callback: callback ?? {} });
  });
  const service = { get, queueService } as unknown as AmazonService;

  const respond = (index: number, data: string) =>
    requests[index].callback.onSuccess?.(data);
  const fail = (index: number, error: any = new Error("Network error")) =>
    requests[index].callback.onError?.(error);

  return { service, get, queueService, requests, respond, fail };
}

export function fakeArgsService({ count = 50 } = {}) {
  const getCountFlag = vi.fn(() => count);
  const service = { getCountFlag } as unknown as ArgsService;
  return { service, getCountFlag };
}

export function fakeAdBuilder(result: AmazonAdBuildResult = {}) {
  const build = vi.fn(() => result);
  const buildUrl = vi.fn((country: { tld: string }, ad: { asin: string }) => ({
    url: `${country.tld}/dp/${ad.asin}`,
    referer: `${country.tld}/ref`,
  }));
  const builder: AmazonAdBuilder = { build, buildUrl };
  return { builder, build, buildUrl };
}
