import type { Document } from "domhandler";
import { find } from "@/shared/utils/html";

const CAPTCHA_ACTIONS = ["/errors/validateCaptcha", "/errors_page/validateCaptcha"];

// Akamai interstitial challenge, reloads the page with a bm-verify token
const INTERSTITIAL = "meta[http-equiv='refresh'][content*='bm-verify=']";

export class AmazonCaptchaDetector {
  detect(document: Document) {
    if (find(INTERSTITIAL, document)) return true;
    return CAPTCHA_ACTIONS.includes(find("form", document)?.attribs.action ?? "");
  }
}
