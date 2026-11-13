const H2_ERRORS = [
  "NO_ERROR",
  "PROTOCOL_ERROR",
  "INTERNAL_ERROR",
  "FLOW_CONTROL_ERROR",
  "SETTINGS_TIMEOUT",
  "STREAM_CLOSED",
  "FRAME_SIZE_ERROR",
  "REFUSED_STREAM",
  "CANCEL",
  "COMPRESSION_ERROR",
  "CONNECT_ERROR",
  "ENHANCE_YOUR_CALM",
  "INADEQUATE_SECURITY",
  "HTTP_1_1_REQUIRED",
];

const h2Error = (message: string) => {
  const code = Number(message.match(/code (\d+)/)?.[1]);
  return H2_ERRORS[code] ?? String(code);
};

// Label of a network failure for the network_errors_<route> metric, max 31 chars
export const toNetworkError = (e: any): string => {
  const code: string | undefined = e?.code;
  const message = String(e?.message ?? "");
  if (code === "ERR_HTTP2_STREAM_ERROR") return `RST_${message.match(/NGHTTP2_(\w+)/)?.[1] ?? "UNKNOWN"}`;
  if (code === "ERR_HTTP2_STREAM_CLOSED") return `RST_${h2Error(message)}`;
  if (code === "ERR_HTTP2_SESSION_ERROR") return `SESSION_${h2Error(message)}`;
  if (code === "ERR_HTTP2_STREAM_CANCEL" && e.cause) return toNetworkError(e.cause);

  return (code ?? "unknown").slice(0, 31);
};
