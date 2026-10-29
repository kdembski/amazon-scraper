import { describe, expect, it, vi } from "vitest";
import { AmazonPlpAdSender } from "@/marketplaces/amazon/plp/AmazonPlpAdSender";
import type { BatchSender } from "@/shared/backend/BatchSender";
import type { AmazonPlpAd } from "@/marketplaces/amazon/types/amazon.types";

const ad = (asin: string) => ({ asin, name: asin, image: `${asin}.jpg`, categoryName: "toys" });

describe("AmazonPlpAdSender", () => {
  it("buffers every ad on its own", () => {
    const add = vi.fn();
    const adSender = new AmazonPlpAdSender({ add } as unknown as BatchSender<AmazonPlpAd>);

    adSender.add([ad("B0A"), ad("B0B")]);

    expect(add.mock.calls).toEqual([[ad("B0A")], [ad("B0B")]]);
  });
});
