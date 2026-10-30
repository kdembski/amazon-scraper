import { describe, expect, it, vi } from "vitest";
import { AmazonPdpResultSender } from "@/marketplaces/amazon/pdp/AmazonPdpResultSender";
import { BatchSender } from "@/shared/backend/BatchSender";

const setup = () => {
  const add = vi.fn();
  const resultSender = new AmazonPdpResultSender({ add } as unknown as BatchSender<any>);
  return { resultSender, add };
};

const price = { adId: 7, countryId: 1, value: 9.99, dispatchFrom: "Amazon" };

describe("AmazonPdpResultSender", () => {
  it("buffers prices and deletes of ads", () => {
    const { resultSender, add } = setup();

    resultSender.prices(7, [price]);
    resultSender.deleted(8);

    expect(add.mock.calls).toEqual([[{ id: 7, prices: [price] }], [{ id: 8 }]]);
  });

  it("sends prices and deleted ids in one body to amazon/ads/batch", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const resultSender = new AmazonPdpResultSender(
      new BatchSender("amazon/ads/batch", AmazonPdpResultSender.toBody, 2, 5000, {
        send,
      } as any, { increment: vi.fn(), gauge: vi.fn() } as any)
    );

    resultSender.prices(7, [price]);
    resultSender.deleted(8);

    expect(send).toHaveBeenCalledWith(
      "amazon/ads/batch",
      { prices: [{ id: 7, prices: [price] }], deleted: [8] },
      expect.any(String)
    );
  });
});
