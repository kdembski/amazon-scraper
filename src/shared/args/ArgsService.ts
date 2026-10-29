import _ from "lodash";
import { Resolver } from "node:dns/promises";
import { networkInterfaces } from "node:os";

export type Target = "pdp" | "plp";

export class ArgsService {
  private static instance: ArgsService;
  private scraperName?: Promise<string | undefined>;

  private constructor(
    private resolver = new Resolver({ timeout: 1000, tries: 1 }),
    private getInterfaces = networkInterfaces
  ) {}

  public static getInstance(): ArgsService {
    if (!ArgsService.instance) {
      ArgsService.instance = new ArgsService();
    }

    return ArgsService.instance;
  }

  getFlagValue(name: string) {
    const args = process.argv;
    const index = args.indexOf(name);

    if (index === -1) return;
    return args[index + 1];
  }

  getTargetFlag(): Target {
    const value = this.getFlagValue("-t") || this.getFlagValue("--target") || "pdp";

    if (value !== "pdp" && value !== "plp") throw new Error(`Unknown target: ${value}`);
    return value;
  }

  getScraperName() {
    this.scraperName ??= this.resolveScraperName();
    return this.scraperName;
  }

  private async resolveScraperName() {
    const { name, NAME_PREFIX } = process.env;
    const replica = await this.getReplica(name);
    const fullName = replica ? `${name}-${replica}` : name;
    return NAME_PREFIX ? `${NAME_PREFIX}-${fullName}` : fullName;
  }

  private async getReplica(name?: string) {
    const address = this.getInterfaces().eth0?.find((i) => i.family === "IPv4")?.address;
    if (!name || !address) return;

    try {
      const hosts = await this.resolver.resolvePtr(
        `${address.split(".").reverse().join(".")}.in-addr.arpa`
      );
      return hosts[0]?.match(new RegExp(`-${_.escapeRegExp(name)}-(\\d+)\\.`))?.[1];
    } catch {
      return;
    }
  }
}
