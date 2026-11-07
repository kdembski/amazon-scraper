import { describe, expect, it } from "vitest";
import { FreeProxyTracker } from "@/shared/http/proxy/FreeProxyTracker";

const de = "www.amazon.de";
const yes = () => true;

describe("FreeProxyTracker", () => {
  it("takes the proxies of a host from the most recently freed", () => {
    const tracker = new FreeProxyTracker();
    tracker.markFree("a", de);
    tracker.markFree("b", de);
    tracker.markFree("c", "www.amazon.fr");

    expect(tracker.takeLast(de, yes, yes)).toBe("b");
    expect(tracker.takeLast(de, yes, yes)).toBe("a");
    expect(tracker.takeLast(de, yes, yes)).toBeUndefined();
  });

  it("moves a proxy freed again to the end", () => {
    const tracker = new FreeProxyTracker();
    tracker.markFree("a", de);
    tracker.markFree("b", de);
    tracker.markFree("a", de);

    expect(tracker.takeLast(de, yes, yes)).toBe("a");
  });

  it("forgets proxies without an idle connection", () => {
    const tracker = new FreeProxyTracker();
    tracker.markFree("a", de);
    tracker.markFree("b", de);

    expect(tracker.takeLast(de, (url) => url === "a", yes)).toBe("a");
    expect(tracker.takeLast(de, yes, yes)).toBeUndefined();
  });

  it("keeps proxies the caller does not accept", () => {
    const tracker = new FreeProxyTracker();
    tracker.markFree("a", de);
    tracker.markFree("b", de);

    expect(tracker.takeLast(de, yes, (url) => url === "a")).toBe("a");
    expect(tracker.takeLast(de, yes, yes)).toBe("b");
  });

  it("returns undefined for an unknown host", () => {
    expect(new FreeProxyTracker().takeLast(de, yes, yes)).toBeUndefined();
  });
});
