import { describe, expect, it, vi } from "vitest";
import { codedError, raceAbort, timedOut } from "@/shared/http/abort";

describe("codedError", () => {
  it("is an Error with the message and code", () => {
    const error = codedError("Proxy 407", "ERR_PROXY_407");

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "Proxy 407", code: "ERR_PROXY_407" });
  });
});

describe("timedOut", () => {
  it("is an ETIMEDOUT error, Request aborted by default", () => {
    expect(timedOut()).toMatchObject({ message: "Request aborted", code: "ETIMEDOUT" });
    expect(timedOut("Connect aborted")).toMatchObject({ message: "Connect aborted" });
  });
});

describe("raceAbort", () => {
  it("settles like the promise and stops listening", async () => {
    const controller = new AbortController();
    const onAbort = vi.fn();

    await expect(raceAbort(Promise.resolve(1), controller.signal, undefined, onAbort)).resolves.toBe(1);
    await expect(raceAbort(Promise.reject(new Error("down")), controller.signal)).rejects.toThrow("down");

    controller.abort();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("runs onAbort and rejects with timedOut once the signal aborts", async () => {
    const controller = new AbortController();
    const onAbort = vi.fn();
    const raced = raceAbort(new Promise(() => {}), controller.signal, "Connect aborted", onAbort);

    controller.abort();

    await expect(raced).rejects.toMatchObject({ message: "Connect aborted", code: "ETIMEDOUT" });
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});
