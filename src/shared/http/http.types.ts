import type { MetricLabels } from "@/shared/metrics/metrics.types";

// Markers that must arrive in this order; a step given as an array is done by
// whichever of its markers comes first
export type StopAt = (string | string[])[];

// How a shop connection goes out: through a proxy or directly over IPv4 / IPv6
export type Route = "proxy" | "direct4" | "direct6";

export type Traffic = {
  labels: MetricLabels;
  bytesIn: number;
  bytesOut: number;
};
