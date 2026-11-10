import { describe, expect, it } from "vitest";
import { AmazonCaptchaDetector } from "@/marketplaces/amazon/AmazonCaptchaDetector";
import { botWallPage, captchaPage, interstitialPage } from "@@tests/support/html";

const detector = new AmazonCaptchaDetector();

describe("AmazonCaptchaDetector", () => {
  it.each([
    ["captcha form", captchaPage],
    ["bot wall", botWallPage],
    ["Akamai interstitial", interstitialPage],
  ])("detects the %s", (_name, page) => {
    expect(detector.detect(page)).toBe(true);
  });

  it.each([
    ["a page without a form", "<div>product</div>"],
    ["a page with another form", `<form action="/cart/add"></form>`],
    ["another meta refresh", `<meta http-equiv="refresh" content="5; URL='/s'" />`],
    ["a marker outside the captcha markup", `<script>var u = "/errors/validateCaptcha";</script><form action="/cart/add"></form>`],
  ])("ignores %s", (_name, page) => {
    expect(detector.detect(page)).toBe(false);
  });
});
