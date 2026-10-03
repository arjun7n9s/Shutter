import type { PiiClass } from "./types";

export interface FieldDescriptor {
  tag: string;
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export interface FieldClass {
  cls: PiiClass | null;
  /** Which signal decided: autocomplete > type > keyword. */
  source: "autocomplete" | "type" | "keyword" | "none";
}

const AUTOCOMPLETE: Record<string, PiiClass> = {
  name: "PERSON",
  "given-name": "PERSON",
  "additional-name": "PERSON",
  "family-name": "PERSON",
  nickname: "PERSON",
  "cc-name": "PERSON",
  email: "EMAIL",
  tel: "PHONE",
  "tel-national": "PHONE",
  "tel-local": "PHONE",
  bday: "DOB",
  "bday-day": "DOB",
  "bday-month": "DOB",
  "bday-year": "DOB",
  "street-address": "ADDRESS",
  "address-line1": "ADDRESS",
  "address-line2": "ADDRESS",
  "address-line3": "ADDRESS",
  "address-level1": "ADDRESS",
  "address-level2": "ADDRESS",
  "postal-code": "PINCODE",
  "cc-number": "CARD",
  "cc-csc": "CARD_CVV",
  "cc-exp": "CARD_EXPIRY",
  "cc-exp-month": "CARD_EXPIRY",
  "cc-exp-year": "CARD_EXPIRY",
  "one-time-code": "OTP",
  "current-password": "PASSWORD",
  "new-password": "PASSWORD",
  username: "USERNAME",
};

/** Ordered: the first matching entry wins, so specific keys precede generic ones. */
const KEYWORDS: Array<[RegExp, PiiClass]> = [
  [/pass(?:word|wd|code)?\b|\bpin\b(?!\s*code)|\bmpin\b|पासवर्ड/, "PASSWORD"],
  [/\botp\b|one.?time|verification.?code|ओटीपी/, "OTP"],
  [/\bcvv|\bcvc|security.?code/, "CARD_CVV"],
  [/expir|valid.?(?:thru|till)|\bexp\b/, "CARD_EXPIRY"],
  [/card.?(?:no|num)|credit.?card|debit.?card|\bccnum/, "CARD"],
  [/\bvid\b|virtual.?id/, "AADHAAR_VID"],
  [/aadha?ar|\buid\b|आधार/, "AADHAAR"],
  [/\bpan\b|pan.?(?:no|num|card)|पैन/, "PAN"],
  [/gstin|\bgst\b/, "GSTIN"],
  [/\bifsc/, "IFSC"],
  [/acc(?:oun)?t.?(?:no|num)|a\/c|bank.?acc|खाता/, "BANK_ACCOUNT"],
  [/\bupi\b|\bvpa\b/, "UPI"],
  [/passport|पासपोर्ट/, "PASSPORT"],
  [/\bepic\b|voter|मतदाता/, "VOTER_ID"],
  [/driving|licen[cs]e|\bdl.?no/, "DRIVING_LICENCE"],
  [/e-?mail|ईमेल/, "EMAIL"],
  [/mobile|phone|\btel\b|\bmob\b|contact.?no|whatsapp|मोबाइल|फ़ोन|फोन/, "PHONE"],
  [/\bdob\b|birth|जन्म/, "DOB"],
  [/pin.?code|postal|\bzip|पिन/, "PINCODE"],
  [/\bip\b|ip.?addr/, "IP_ADDRESS"],
  [/address|street|locality|\bhouse\b|\bflat\b|landmark|\bcity\b|district|पता/, "ADDRESS"],
  [/user.?(?:name|id)|login.?id/, "USERNAME"],
  [/(?:first|last|middle|full|given|family|sur|father|mother|spouse|applicant|guardian).?name|\bname\b|bill(?:ed)?.?to|ship.?to|consignee|(?:account|card).?holder|नाम/, "PERSON"],
  [/^(?!.*\b(?:id|no|number|code|type|care|support|count|status|class|quota)\b).*\b(?:customer|passenger|patient|payee|payer|nominee|sender|recipient)s?\b/, "PERSON"],
];

function norm(s: string | undefined): string {
  return (s ?? "").toLowerCase().replace(/[_\-\[\]]+/g, " ");
}

export function classifyField(f: FieldDescriptor): FieldClass {
  const ac = (f.autocomplete ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = ac.length - 1; i >= 0; i--) {
    const cls = AUTOCOMPLETE[ac[i]!];
    if (cls) return { cls, source: "autocomplete" };
  }
  const type = (f.type ?? "").toLowerCase();
  if (type === "password") return { cls: "PASSWORD", source: "type" };
  if (type === "email") return { cls: "EMAIL", source: "type" };
  if (type === "tel") return { cls: "PHONE", source: "type" };

  const hay = [f.label, f.ariaLabel, f.placeholder, f.name, f.id].map(norm).join(" | ");
  for (const [re, cls] of KEYWORDS) if (re.test(hay)) return { cls, source: "keyword" };
  return { cls: null, source: "none" };
}

/** Which field classes a token of a given class may be typed into. */
const FILL_COMPAT: Partial<Record<PiiClass, PiiClass[]>> = {
  EMAIL: ["EMAIL", "USERNAME"],
  PHONE: ["PHONE", "USERNAME"],
  USERNAME: ["USERNAME", "EMAIL"],
  PERSON: ["PERSON"],
  DOB: ["DOB"],
  ADDRESS: ["ADDRESS"],
  PINCODE: ["PINCODE", "ADDRESS"],
  AADHAAR: ["AADHAAR"],
  AADHAAR_VID: ["AADHAAR_VID", "AADHAAR"],
  PAN: ["PAN"],
  GSTIN: ["GSTIN"],
  IFSC: ["IFSC"],
  BANK_ACCOUNT: ["BANK_ACCOUNT"],
  CARD: ["CARD"],
  CARD_EXPIRY: ["CARD_EXPIRY"],
  UPI: ["UPI"],
  PASSPORT: ["PASSPORT"],
  VOTER_ID: ["VOTER_ID"],
  DRIVING_LICENCE: ["DRIVING_LICENCE"],
};

export function fillCompatible(tokenCls: PiiClass, fieldCls: PiiClass | null): boolean {
  if (fieldCls === null) return false;
  return FILL_COMPAT[tokenCls]?.includes(fieldCls) ?? false;
}
