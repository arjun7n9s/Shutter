export const PII_CLASSES = [
  "PERSON",
  "EMAIL",
  "PHONE",
  "AADHAAR",
  "AADHAAR_VID",
  "PAN",
  "GSTIN",
  "IFSC",
  "BANK_ACCOUNT",
  "CARD",
  "CARD_CVV",
  "CARD_EXPIRY",
  "UPI",
  "DOB",
  "ADDRESS",
  "PINCODE",
  "PASSPORT",
  "VOTER_ID",
  "DRIVING_LICENCE",
  "OTP",
  "PASSWORD",
  "USERNAME",
  "IP_ADDRESS",
  "SECRET",
] as const;

export type PiiClass = (typeof PII_CLASSES)[number];

/** Classes whose values may never be released back to the page, even with approval. */
export const NEVER_RELEASE: ReadonlySet<PiiClass> = new Set(["PASSWORD", "OTP", "CARD_CVV", "SECRET"]);

export interface Span {
  start: number;
  end: number;
  cls: PiiClass;
  score: number;
  /** Detector that produced the span, for per-rule evaluation. */
  rule: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
