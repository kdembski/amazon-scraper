import _ from "lodash";
import { Resolver } from "node:dns/promises";
import { networkInterfaces } from "node:os";

export class ScraperNameResolver {
  private static instance: ScraperNameResolver;
  private name?: Promise<string | undefined>;

  private constructor(
    private resolver = new Resolver({ timeout: 1000, tries: 1 }),
    private getInterfaces = networkInterfaces
  ) {}

  public static getInstance(): ScraperNameResolver {
    if (!ScraperNameResolver.instance) {
      ScraperNameResolver.instance = new ScraperNameResolver();
    }

    return ScraperNameResolver.instance;
  }

  get() {
    this.name ??= this.resolve();
    return this.name;
  }

  private async resolve() {
    const { name, NAME_PREFIX } = process.env;
    const replica = await this.getReplica(name);
    const fullName = replica ? `${name}-${replica}` : name;
    return NAME_PREFIX ? `${NAME_PREFIX}-${fullName}` : fullName;
  }

  // Replica number from the container's reverse DNS name ("...-<name>-2." gives "2")
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
