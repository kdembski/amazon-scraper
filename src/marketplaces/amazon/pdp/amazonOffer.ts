import type { Element } from "domhandler";
import { find, text } from "@/shared/utils/html";

export const getOfferPrice = (priceBox: Element) => {
  const container =
    find(".apex-pricetopay-value", priceBox) ??
    find(".a-price", priceBox);

  // The whole part ends with the marketplace's decimal separator ("12," or "12.")
  const whole = getDigits(
    text(container && find(".a-price-whole", container))
  );
  const fraction = getDigits(
    text(container && find(".a-price-fraction", container))
  );

  if (whole && fraction) {
    return parse(`${whole}.${fraction}`);
  }

  // .a-offscreen is usually empty in this fragment, so the accessibility
  // label goes first
  return (
    parseLabel(text(find(".apex-pricetopay-accessibility-label", priceBox))) ??
    parseLabel(text(container && find(".a-offscreen", container)))
  );
};

export const normalizeDispatchFrom = (value: string | null | undefined) => {
  const dispatchFrom = value?.replace(/\s+/g, " ").trim();

  // Some marketplaces (e.g. nl) name Amazon by its domain here, while the
  // product page and the backend use plain "Amazon"
  if (dispatchFrom && /^amazon(\.[a-z]{2,3})+$/i.test(dispatchFrom)) {
    return "Amazon";
  }

  return dispatchFrom || undefined;
};

const getDigits = (text: string | null | undefined) => text?.replace(/\D/g, "");

// "19,99 €", "€1,299.00", "1.299 €": a separator followed by one or two
// digits at the end is the decimal one, any other separates thousands
const parseLabel = (label: string | null | undefined) => {
  const price = label?.replace(/[^\d.,]/g, "") ?? "";
  const [, whole, fraction = "0"] = price.match(/^(.*?)(?:[.,](\d{1,2}))?$/)!;
  const digits = getDigits(whole);

  if (!digits) return;
  return parse(`${digits}.${fraction}`);
};

const parse = (value: string) => parseFloat(parseFloat(value).toFixed(2));
