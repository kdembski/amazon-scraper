export class ArgsService {
  private static instance: ArgsService;

  private constructor() {}

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

  getLimitFlag() {
    const value = this.getFlagValue("-l") || this.getFlagValue("--limit");

    if (!value) return 10;
    return parseInt(value);
  }

  // Max requests to Amazon started per second, 0 means unlimited
  getRateFlag() {
    const value = this.getFlagValue("-r") || this.getFlagValue("--rate");

    if (!value) return 0;
    return parseInt(value);
  }

  getCountFlag() {
    const value = this.getFlagValue("-c") || this.getFlagValue("--count");

    if (!value) return 50;
    return parseInt(value);
  }

  getTargetFlag() {
    const value = this.getFlagValue("-t") || this.getFlagValue("--target");

    const isPlp = value === "plp";
    const isPdp = !value || value === "pdp";
    return { isPdp, isPlp };
  }

  // Where PDP mode reads prices from: the light "All Offers Display" ajax
  // fragment (default) or the full product page
  getSourceFlag() {
    const value = this.getFlagValue("-s") || this.getFlagValue("--source");

    const isAod = value !== "pdp";
    return { isAod };
  }
}
