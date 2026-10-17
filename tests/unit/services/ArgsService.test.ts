import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArgsService } from "@/services/ArgsService";

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

  describe("getLimitFlag", () => {
    it("defaults to 10", () => {
      expect(args.getLimitFlag()).toBe(10);
    });

    it.each([["-l"], ["--limit"]])("reads %s", (flag) => {
      setArgs(flag, "500");
      expect(args.getLimitFlag()).toBe(500);
    });
  });

  describe("getRateFlag", () => {
    it("defaults to 0 (unlimited)", () => {
      expect(args.getRateFlag()).toBe(0);
    });

    it.each([["-r"], ["--rate"]])("reads %s", (flag) => {
      setArgs(flag, "200");
      expect(args.getRateFlag()).toBe(200);
    });
  });

  describe("getRateFlag", () => {
    it("defaults to 0 (unlimited)", () => {
      expect(args.getRateFlag()).toBe(0);
    });

    it.each([["-r"], ["--rate"]])("reads %s", (flag) => {
      setArgs(flag, "11");
      expect(args.getRateFlag()).toBe(11);
    });
  });

  describe("getCountFlag", () => {
    it("defaults to 50", () => {
      expect(args.getCountFlag()).toBe(50);
    });

    it.each([["-c"], ["--count"]])("reads %s", (flag) => {
      setArgs(flag, "1000");
      expect(args.getCountFlag()).toBe(1000);
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

  describe("getSourceFlag", () => {
    it("defaults to aod", () => {
      expect(args.getSourceFlag()).toEqual({ isAod: true, isPage: false });
    });

    it.each([["-s"], ["--source"]])("reads pdp from %s", (flag) => {
      setArgs(flag, "pdp");
      expect(args.getSourceFlag()).toEqual({ isAod: false, isPage: true });
    });
  });
});
