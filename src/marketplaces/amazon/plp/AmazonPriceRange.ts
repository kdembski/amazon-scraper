// 1 000 000 zł, an open range from here on is not split
const MAX_OPEN_MIN = 100000000;

// Amazon price filter (p_36) in grosze, both ends inclusive, no max = open
export class AmazonPriceRange {
  constructor(
    public min: number,
    public max?: number
  ) {}

  static parse(value: string) {
    const [min, max] = value.split("-");
    return new AmazonPriceRange(Number(min), max ? Number(max) : undefined);
  }

  split(): [AmazonPriceRange, AmazonPriceRange] | undefined {
    const { min, max } = this;
    if (max === undefined) {
      if (min <= 0 || min >= MAX_OPEN_MIN) return;
      return [new AmazonPriceRange(min, 2 * min - 1), new AmazonPriceRange(2 * min)];
    }
    if (min >= max) return;

    const mid = Math.floor((min + max) / 2);
    return [new AmazonPriceRange(min, mid), new AmazonPriceRange(mid + 1, max)];
  }

  toFilter() {
    return `p_36%3A${this.min || ""}-${this.max ?? ""}`;
  }
}
