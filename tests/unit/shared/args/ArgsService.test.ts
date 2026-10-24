import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArgsService } from "@/shared/args/ArgsService";

describe("ArgsService", () => {
  const originalArgv = process.argv;
  const args = ArgsService.getInstance();

  const setArgs = (...flags: string[]) => {
    process.argv = ["node", "index.ts", ...flags];
  };

  beforeEach(() => setArgs());
  afterEach(() => {
    process.argv = originalArgv;
  });

  it("is a singleton", () => {
    expect(ArgsService.getInstance()).toBe(args);
  });

  describe("getFlagValue", () => {
    it("returns the value following the flag", () => {
      setArgs("-x", "foo");
      expect(args.getFlagValue("-x")).toBe("foo");
    });

    it("returns undefined for a missing flag", () => {
      expect(args.getFlagValue("-x")).toBeUndefined();
    });
  });

  describe("getTargetFlag", () => {
    it("defaults to pdp", () => {
      expect(args.getTargetFlag()).toEqual({ isPdp: true, isPlp: false });
    });

    it.each([["-t"], ["--target"]])("reads plp from %s", (flag) => {
      setArgs(flag, "plp");
      expect(args.getTargetFlag()).toEqual({ isPdp: false, isPlp: true });
    });

    it("reads explicit pdp", () => {
      setArgs("-t", "pdp");
      expect(args.getTargetFlag()).toEqual({ isPdp: true, isPlp: false });
    });

    it("treats an unknown target as neither mode", () => {
      setArgs("-t", "foo");
      expect(args.getTargetFlag()).toEqual({ isPdp: false, isPlp: false });
    });
  });
});
