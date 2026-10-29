import type { Element } from "domhandler";
import { find, text } from "@/shared/utils/html";

export class AmazonPriceParser {
  parse(priceBox: Element) {
    const container =
      find(".apex-pricetopay-value", priceBox) ??
      find(".a-price", priceBox);

    // The whole part ends with the marketplace's decimal separator ("12," or "12.")
    const whole = this.getDigits(
      text(container && find(".a-price-whole", container))
    );
    const fraction = this.getDigits(
      text(container && find(".a-price-fraction", container))
    );

    if (whole && fraction) {
      return this.toNumber(`${whole}.${fraction}`);
    }

    // .a-offscreen is usually empty in this fragment, so the accessibility
    // label goes first
    return (
      this.parseLabel(text(find(".apex-pricetopay-accessibility-label", priceBox))) ??
      this.parseLabel(text(container && find(".a-offscreen", container)))
    );
  }

  private getDigits(value: string | null | undefined) {
    return value?.replace(/\D/g, "");
  }

  // "19,99 €", "€1,299.00", "1.299 €": a separator followed by one or two
  // digits at the end is the decimal one, any other separates thousands
  private parseLabel(label: string | null | undefined) {
    const price = label?.replace(/[^\d.,]/g, "") ?? "";
    const [, whole, fraction = "0"] = price.match(/^(.*?)(?:[.,](\d{1,2}))?$/)!;
    const digits = this.getDigits(whole);

    if (!digits) return;
    return this.toNumber(`${digits}.${fraction}`);
  }

  private toNumber(value: string) {
    return parseFloat(parseFloat(value).toFixed(2));
  }
}
