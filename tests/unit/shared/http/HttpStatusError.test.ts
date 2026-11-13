import { describe, expect, it } from "vitest";
import { HttpStatusError } from "@/shared/http/HttpStatusError";

describe("HttpStatusError", () => {
  it("carries status and message", () => {
    const error = new HttpStatusError(403);

    expect(error.status).toBe(403);
    expect(error.message).toBe("HTTP 403");
  });
});
