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
      expect(args.getTargetFlag()).toBe("pdp");
    });

    it.each([["-t"], ["--target"]])("reads plp from %s", (flag) => {
      setArgs(flag, "plp");
      expect(args.getTargetFlag()).toBe("plp");
    });

    it("reads explicit pdp", () => {
      setArgs("-t", "pdp");
      expect(args.getTargetFlag()).toBe("pdp");
    });

    it("throws on an unknown target", () => {
      setArgs("-t", "foo");
      expect(() => args.getTargetFlag()).toThrow("Unknown target: foo");
    });
  });

  describe("getScraperName", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.name;
      delete process.env.NAME_PREFIX;
    });
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("returns name without NAME_PREFIX", () => {
      process.env.name = "amazon-pdp-1";
      expect(args.getScraperName()).toBe("amazon-pdp-1");
    });

    it("prefixes name with NAME_PREFIX", () => {
      process.env.name = "amazon-pdp-1";
      process.env.NAME_PREFIX = "home";
      expect(args.getScraperName()).toBe("home-amazon-pdp-1");
    });
  });
});
