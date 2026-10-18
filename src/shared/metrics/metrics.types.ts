export type MetricLabels = { country?: string; outcome?: string };

export type MetricRow = {
  metric: string;
  country?: string;
  outcome?: string;
  value: number;
};

export type RequestOutcome = "ok" | "timeout" | "network" | `http_${number}`;
export type ResponseOutcome =
  | "data"
  | "no_data"
  | "captcha"
  | "invalid"
  | "empty";
export type ItemOutcome = "data" | "no_data" | "deleted" | "given_up";
