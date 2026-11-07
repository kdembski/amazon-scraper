import { describe, expect, it } from "vitest";
import { toRequestOutcome } from "@/shared/metrics/toRequestOutcome";

describe("toRequestOutcome", () => {
  it.each([
    [{ response: { status: 503 } }, "http_503"],
    [{ response: { status: 404 }, code: "ERR_BAD_REQUEST" }, "http_404"],
    [{ code: "ERR_CANCELED" }, "timeout"],
    [{ code: "ECONNABORTED" }, "timeout"],
    [{ code: "ETIMEDOUT" }, "timeout"],
    [{ code: "ECONNRESET" }, "network"],
    [new Error("down"), "network"],
    [undefined, "network"],
  ])("maps %j to %s", (error, outcome) => {
    expect(toRequestOutcome(error)).toBe(outcome);
  });
});
