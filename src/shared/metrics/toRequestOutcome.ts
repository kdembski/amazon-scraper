import type { RequestOutcome } from "@/shared/metrics/metrics.types";

const TIMEOUT_CODES = ["ERR_CANCELED", "ECONNABORTED", "ETIMEDOUT"];

export const toRequestOutcome = (e: any): RequestOutcome => {
  const status = e?.response?.status;
  if (status) return `http_${status}`;
  return TIMEOUT_CODES.includes(e?.code) ? "timeout" : "network";
};
