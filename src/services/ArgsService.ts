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

  getCountFlag() {
    const value = this.getFlagValue("-c") || this.getFlagValue("--count");

    if (!value) return 50;
    return parseInt(value);
  }
}
