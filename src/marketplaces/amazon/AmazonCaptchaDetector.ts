import { parseDocument } from "htmlparser2";
import { find } from "@/shared/utils/html";

const CAPTCHA_ACTIONS = ["/errors/validateCaptcha", "/errors_page/validateCaptcha"];

// Akamai interstitial challenge, reloads the page with a bm-verify token
const INTERSTITIAL = "meta[http-equiv='refresh'][content*='bm-verify=']";

// Text every captcha variant contains; html without it is not parsed
const MARKERS = ["validateCaptcha", "bm-verify="];

export class AmazonCaptchaDetector {
  detect(html: string) {
    if (!MARKERS.some((marker) => html.includes(marker))) return false;

    const document = parseDocument(html);
    if (find(INTERSTITIAL, document)) return true;
    return CAPTCHA_ACTIONS.includes(find("form", document)?.attribs.action ?? "");
  }
}
