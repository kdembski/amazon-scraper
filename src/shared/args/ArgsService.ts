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

  getTargetFlag() {
    const value = this.getFlagValue("-t") || this.getFlagValue("--target");

    const isPlp = value === "plp";
    const isPdp = !value || value === "pdp";
    return { isPdp, isPlp };
  }
}
