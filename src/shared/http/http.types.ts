import type http2 from "node:http2";
import type { Readable } from "node:stream";
import type { MetricLabels } from "@/shared/metrics/metrics.types";

// Markers that must arrive in this order; a step given as an array is done by
// whichever of its markers comes first
export type StopAt = (string | string[])[];

export type ScrapingRequest = {
  referer?: string;
  labels?: MetricLabels;
  proxyType?: string;
  stopAt?: StopAt;
  isCancelled?: () => boolean;
};

// How a shop connection goes out: through a proxy or directly over IPv4 / IPv6
export type Route = "proxy" | "direct4" | "direct6";

export type Traffic = {
  labels: MetricLabels;
  bytesIn: number;
  bytesOut: number;
};

// Proxies of one datacenter plan; weight is the bandwidth left per ms of its
// billing period
export type ProxyPlan = {
  urls: string[];
  weight: number;
};

export type Fingerprint = {
  chromeVersion: number;
  // In send order, after the pseudo-headers
  headers: [string, string][];
  tls: { ciphers: string; sigalgs: string; ecdhCurve: string };
  settings: http2.Settings;
};

// Body already decompressed
export type ShopResponse = {
  status: number;
  headers: http2.IncomingHttpHeaders;
  body: Readable;
};
