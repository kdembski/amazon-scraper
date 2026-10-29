export class AmazonDispatchFromNormalizer {
  normalize(value: string | null | undefined) {
    const dispatchFrom = value?.replace(/\s+/g, " ").trim();

    // Some marketplaces (e.g. nl) name Amazon by its domain here, while the
    // product page and the backend use plain "Amazon"
    if (dispatchFrom && /^amazon(\.[a-z]{2,3})+$/i.test(dispatchFrom)) {
      return "Amazon";
    }

    return dispatchFrom || undefined;
  }
}
