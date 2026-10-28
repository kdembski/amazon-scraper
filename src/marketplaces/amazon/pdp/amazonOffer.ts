import type { Document, Element } from "domhandler";
import type { AmazonAdBuildResult } from "@/marketplaces/amazon/types/amazon.types";
import { find, findAll, text } from "@/shared/utils/html";

const CAPTCHA_ACTIONS = ["/errors/validateCaptcha", "/errors_page/validateCaptcha"];
const SUBSCRIPTION_ROWS = ["snsAccordionRowMiddle", "subscriptionPrice"];
const CART_PRICE = "input[name='items[0.base][customerVisiblePrice][amount]']";

export const isCaptchaPage = (document: Document) =>
  CAPTCHA_ACTIONS.includes(find("form", document)?.attribs.action ?? "");

// Product page buy box (twister fragment, gp/aw/d)
export const buildBuybox = (buybox: Element | null | undefined): AmazonAdBuildResult => {
  const isValid = !!buybox && !find("#priceNotAvailable", buybox);
  const price = buybox && getBuyboxPrice(buybox);

  if (!isValid || !price) {
    return { isCaptcha: false, isValid };
  }

  return {
    isCaptcha: false,
    isValid,
    price,
    dispatchFrom: getBuyboxDispatchFrom(buybox),
  };
};

const getBuyboxPrice = (buybox: Element) => {
  const priceToPay = findAll(".apex-pricetopay-value", buybox).find(
    (element) => !isSubscription(element, buybox)
  );
  if (priceToPay) return getOfferPrice(priceToPay.parent as Element);

  return Number(find(CART_PRICE, buybox)?.attribs.value) || undefined;
};

const isSubscription = (element: Element, buybox: Element) => {
  for (let node = element.parent; node && node !== buybox; node = node.parent) {
    if (SUBSCRIPTION_ROWS.includes((node as Element).attribs?.id)) return true;
  }
  return false;
};

const getBuyboxDispatchFrom = (buybox: Element) => {
  const message = (name: string) =>
    text(
      find(
        `[offer-display-feature-name='${name}'] .offer-display-feature-text-message`,
        buybox
      )
    );

  return normalizeDispatchFrom(
    message("desktop-fulfiller-info") || message("desktop-merchant-info")
  );
};

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
