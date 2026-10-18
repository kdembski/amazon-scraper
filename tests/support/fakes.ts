import { vi } from "vitest";
import type { AmazonService } from "@/services/AmazonService";
import type { ApiService } from "@/shared/backend/ApiService";
import type { ArgsService } from "@/shared/args/ArgsService";
import type { CountryService } from "@/shared/backend/CountryService";
import type { AmazonAdBuilder, AmazonAdBuildResult } from "@/types/amazon.types";

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

export function fakeCountryService() {
  const getCountries = vi.fn().mockResolvedValue([]);
  const service = { getCountries } as unknown as CountryService;
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
  const queueService = { completed: 0, failed: 0, queue: [] as Function[] };
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
  const buildUrl = vi.fn((country: { code: string }, ad: { asin: string }) => ({
    url: `${country.code}/dp/${ad.asin}`,
    referer: `${country.code}/ref`,
  }));
  const builder: AmazonAdBuilder = { build, buildUrl };
  return { builder, build, buildUrl };
}
