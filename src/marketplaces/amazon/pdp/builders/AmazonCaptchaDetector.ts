import type { Document } from "domhandler";
import { find } from "@/shared/utils/html";

const CAPTCHA_ACTIONS = ["/errors/validateCaptcha", "/errors_page/validateCaptcha"];

export class AmazonCaptchaDetector {
  detect(document: Document) {
    return CAPTCHA_ACTIONS.includes(find("form", document)?.attribs.action ?? "");
  }
}
