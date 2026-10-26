// Amazon price filter (p_36) in grosze, both ends inclusive, no max = open
export type PriceRange = { min: number; max?: number };

export const parsePriceRange = (value: string): PriceRange => {
  const [min, max] = value.split("-");
  return max ? { min: Number(min), max: Number(max) } : { min: Number(min) };
};

export const splitPriceRange = (
  range: PriceRange
): [PriceRange, PriceRange] | undefined => {
  const { min, max } = range;
  if (max === undefined) return [{ min, max: 2 * min - 1 }, { min: 2 * min }];
  if (min >= max) return;

  const mid = Math.floor((min + max) / 2);
  return [
    { min, max: mid },
    { min: mid + 1, max },
  ];
};

export const toPriceFilter = ({ min, max }: PriceRange) =>
  `p_36%3A${min || ""}-${max ?? ""}`;
