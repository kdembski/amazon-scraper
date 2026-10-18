import { describe, expect, it } from "vitest";
import { getRetryDelay } from "@/shared/utils/retry";

describe("getRetryDelay", () => {
  const max = () => 1;
  const min = () => 0;

  it("doubles the delay with every failure", () => {
    expect(getRetryDelay(1, max)).toBe(1000);
    expect(getRetryDelay(2, max)).toBe(2000);
    expect(getRetryDelay(3, max)).toBe(4000);
    expect(getRetryDelay(6, max)).toBe(32000);
  });

  it("caps the delay at 60s", () => {
    expect(getRetryDelay(7, max)).toBe(60000);
    expect(getRetryDelay(50, max)).toBe(60000);
  });

  it("randomizes the delay down to half", () => {
    expect(getRetryDelay(3, min)).toBe(2000);
    expect(getRetryDelay(50, min)).toBe(30000);
  });

  it("treats zero failures like the first one", () => {
    expect(getRetryDelay(0, max)).toBe(1000);
  });
});
