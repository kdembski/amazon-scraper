import { describe, expect, it } from "vitest";
import { toNetworkError } from "@/shared/metrics/toNetworkError";

const error = (code: string, message = "", extra: object = {}) =>
  Object.assign(new Error(message), { code }, extra);

describe("toNetworkError", () => {
  it.each([
    [error("ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM"), "RST_ENHANCE_YOUR_CALM"],
    [error("ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_REFUSED_STREAM"), "RST_REFUSED_STREAM"],
    [error("ERR_HTTP2_STREAM_CLOSED", "Stream closed with code 8"), "RST_CANCEL"],
    [error("ERR_HTTP2_STREAM_CLOSED", "Stream closed with code 0"), "RST_NO_ERROR"],
    [error("ERR_HTTP2_SESSION_ERROR", "Session closed with error code 11"), "SESSION_ENHANCE_YOUR_CALM"],
    [error("ERR_HTTP2_SESSION_ERROR", "Session closed with error code 99"), "SESSION_99"],
    [error("ERR_HTTP2_STREAM_CANCEL", "canceled", { cause: error("ECONNRESET") }), "ECONNRESET"],
    [error("ECONNRESET"), "ECONNRESET"],
    [error("ERR_PROXY_502"), "ERR_PROXY_502"],
    [error("ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL_VERY_LONG"), "ERR_SSL_TLSV1_ALERT_NO_APPLICAT"],
    [new Error("down"), "unknown"],
    [undefined, "unknown"],
  ])("maps %s to %s", (input, expected) => {
    expect(toNetworkError(input)).toBe(expected);
  });
});
