import { aadhaarValid, digitsOnly, gstinValid, luhnValid, panValid, verhoeffValid } from "./checksums";
import { GIVEN_NAMES, SURNAME_SET } from "./names";
import type { PiiClass, Span } from "./types";

interface Rule {
  rule: string;
  cls: PiiClass;
  re: RegExp;
  score: number;
  /** Capture group holding the PII value; the rest of the match is context. */
  group?: number;
  validate?: (value: string) => boolean;
  /** Keyword that must appear shortly before the match. */
  context?: RegExp;
  contextWindow?: number;
  /** When the context keyword is present, the class is upgraded (e.g. card-like digits after "VID"). */
  contextCls?: PiiClass;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DEV = "\\u0900-\\u097F";
const NAME_WORD = `[A-Z][a-zA-Z'’-]+`;
const NAME_LATIN = `${NAME_WORD}(?:[ \\t]+(?:${NAME_WORD}|[A-Z]\\.?(?![a-zA-Z]))){0,3}`;
const NAME_DEV = `[${DEV}]+(?:[ \\t]+[${DEV}]+){0,2}`;
/** At least two words: used where no label vouches for the text being a name. */
const NAME_LATIN2 = `${NAME_WORD}(?:[ \\t]+(?:${NAME_WORD}|[A-Z]\\.?(?![a-zA-Z]))){1,3}`;
const PHONE_AHEAD = `(?:\\+91[ -]?)?[6-9]\\d{4}[ -]?\\d{5}(?!\\d)`;
const PERSON_LABELS = [
  "full name", "applicant name", "name of applicant", "father name", "mother name", "bill to", "billed to", "ship to",
  "consignee", "beneficiary", "account holder", "card holder", "customer", "passenger", "patient", "payee", "payer",
  "nominee", "sender", "recipient", "guardian", "name",
];
const SALUTATION_STOP = /^(?:Team|Sir|Madam|All|There|Everyone|Customer|User|Friends?|Colleagues|Applicant|Member|Valued)\b/;

/** Case-insensitive literal without the `i` flag, so name capture keeps requiring capitals. */
function ci(word: string): string {
  return word.replace(/[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`).replace(/ /g, "[ \\t]+");
}

const RULES: Rule[] = [
  {
    rule: "secret.jwt",
    cls: "SECRET",
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    score: 0.99,
  },
  {
    rule: "secret.key",
    cls: "SECRET",
    re: /(?<![A-Za-z0-9])(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|rzp_(?:live|test)_[A-Za-z0-9]{14,})(?![A-Za-z0-9])/g,
    score: 0.99,
  },
  {
    rule: "secret.label",
    cls: "SECRET",
    re: /(?<![A-Za-z])(?:api[ _-]?key|secret(?:[ _-]?key)?|access[ _-]?token|auth[ _-]?token|client[ _-]?secret|private[ _-]?key)[^\n:=]{0,12}[:=][ \t]*["']?([A-Za-z0-9_\-+/]{20,}={0,2})/gi,
    group: 1,
    validate: (v) => /\d/.test(v) && /[A-Za-z]/.test(v),
    score: 0.9,
  },
  {
    rule: "secret.bearer",
    cls: "SECRET",
    re: /Bearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
    group: 1,
    score: 0.95,
  },
  {
    rule: "email",
    cls: "EMAIL",
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
    score: 0.99,
  },
  {
    // A VPA has no dot after the handle, which separates it from email.
    rule: "upi",
    cls: "UPI",
    re: /(?<![A-Za-z0-9._@-])[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![A-Za-z0-9.@-])/g,
    score: 0.9,
  },
  {
    rule: "gstin",
    cls: "GSTIN",
    re: /(?<![A-Z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Z0-9])/g,
    validate: gstinValid,
    score: 0.99,
  },
  {
    rule: "pan",
    cls: "PAN",
    re: /(?<![A-Za-z0-9])[A-Za-z]{3}[ABCFGHJLPTabcfghjlpt][A-Za-z]\d{4}[A-Za-z](?![A-Za-z0-9])/g,
    validate: (v) => panValid(v.toUpperCase()),
    score: 0.95,
  },
  {
    rule: "ifsc",
    cls: "IFSC",
    re: /(?<![A-Z0-9])[A-Z]{4}0[A-Z0-9]{6}(?![A-Z0-9])/g,
    score: 0.85,
  },
  {
    rule: "aadhaar",
    cls: "AADHAAR",
    re: /(?<![\d-])[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![\d-])/g,
    validate: (v) => aadhaarValid(digitsOnly(v)),
    score: 0.97,
  },
  {
    rule: "aadhaar.vid",
    cls: "AADHAAR_VID",
    re: /(?<![\d-])\d{4}([ -]?)\d{4}\1\d{4}\1\d{4}(?![\d-])/g,
    validate: (v) => verhoeffValid(digitsOnly(v)),
    context: /\b(?:vid|virtual\s*id)\b/i,
    score: 0.97,
  },
  {
    rule: "card",
    cls: "CARD",
    re: /(?<![\d-])[2-6](?:[ -]?\d){12,18}(?![\d-])/g,
    validate: (v) => {
      const d = digitsOnly(v);
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    },
    score: 0.96,
  },
  {
    rule: "phone.in",
    cls: "PHONE",
    re: /(?<![\d+])(?:(?:\+|00)?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d])/g,
    score: 0.93,
  },
  {
    rule: "card.expiry",
    cls: "CARD_EXPIRY",
    re: /(?<!\d)(0[1-9]|1[0-2])\s?\/\s?(\d{2}|20\d{2})(?![\d/])/g,
    context: /\b(?:exp|expiry|expires|valid\s*thru|valid\s*till)\b/i,
    contextWindow: 24,
    score: 0.9,
  },
  {
    rule: "card.cvv",
    cls: "CARD_CVV",
    re: /(?<!\d)\d{3,4}(?!\d)/g,
    context: /\b(?:cvv|cvc|cvv2|security\s*code)\b/i,
    contextWindow: 16,
    score: 0.9,
  },
  {
    rule: "otp",
    cls: "OTP",
    re: /(?<!\d)\d{4,8}(?!\d)/g,
    context: /(?:\botp\b|one[- ]time|verification\s*code|passcode|ओटीपी)/i,
    contextWindow: 40,
    score: 0.9,
  },
  {
    rule: "bank.account",
    cls: "BANK_ACCOUNT",
    re: /(?<![\d-])\d{9,18}(?![\d-])/g,
    context: /(?:\ba\/c\b|\bacct\b|\baccount\b|खाता)/i,
    contextWindow: 40,
    score: 0.88,
  },
  {
    rule: "dob",
    cls: "DOB",
    re: new RegExp(
      `(?<!\\d)(?:\\d{1,2}(?:st|nd|rd|th)?[\\/\\-. ](?:\\d{1,2}|(?:${MONTHS})[a-z]*)[\\/\\-., ]\\s?\\d{4}|\\d{4}-\\d{2}-\\d{2})(?!\\d)`,
      "gi",
    ),
    context: /(?:\bdob\b|d\.o\.b|\bbirth|\bborn\b|जन्म)/i,
    contextWindow: 40,
    score: 0.9,
  },
  {
    rule: "pincode",
    cls: "PINCODE",
    re: /(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)/g,
    context: /(?:\bpin\b|pin\s*code|pincode|postal|\bzip\b|पिन)/i,
    contextWindow: 32,
    score: 0.85,
  },
  {
    rule: "passport",
    cls: "PASSPORT",
    re: /(?<![A-Z0-9])[A-PR-WY][1-9]\d{5}[1-9](?![A-Z0-9])/g,
    context: /(?:passport|पासपोर्ट)/i,
    contextWindow: 48,
    score: 0.9,
  },
  {
    rule: "voter.epic",
    cls: "VOTER_ID",
    re: /(?<![A-Z0-9])[A-Z]{3}\d{7}(?![A-Z0-9])/g,
    context: /(?:\bepic\b|voter|elector|मतदाता)/i,
    contextWindow: 48,
    score: 0.88,
  },
  {
    rule: "driving.licence",
    cls: "DRIVING_LICENCE",
    re: /(?<![A-Z0-9])[A-Z]{2}[- ]?\d{2}[- ]?(?:19|20)\d{2}\d{7}(?![A-Z0-9])/g,
    score: 0.9,
  },
  {
    rule: "ipv4",
    cls: "IP_ADDRESS",
    re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
    score: 0.7,
  },
  {
    rule: "person.honorific",
    cls: "PERSON",
    re: new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Dr|Shri|Smt|Sri|Kumari|Km|Prof)\\.?[ \\t]+(${NAME_LATIN})`, "g"),
    group: 1,
    score: 0.85,
  },
  {
    rule: "person.honorific.dev",
    cls: "PERSON",
    re: new RegExp(`(?:श्रीमती|श्री|सुश्री|कुमारी|डॉ\\.?)[ \\t]+(${NAME_DEV})`, "g"),
    group: 1,
    score: 0.85,
  },
  {
    rule: "person.relation",
    cls: "PERSON",
    re: new RegExp(`\\b(?:S|D|W|C)\\/[Oo][ \\t]*:?[ \\t]*(${NAME_LATIN}|${NAME_DEV})`, "g"),
    group: 1,
    score: 0.85,
  },
  {
    rule: "person.label",
    cls: "PERSON",
    re: new RegExp(
      `(?:(?<![A-Za-z])(?:${PERSON_LABELS.map(ci).join("|")})|नाम)[ \\t]*[:：\\-–][ \\t]*(${NAME_LATIN}|${NAME_DEV})`,
      "g",
    ),
    group: 1,
    score: 0.8,
  },
  {
    // RFC 5322 display name: "Kabir Kapoor <kabir@example.com>".
    rule: "person.display_name",
    cls: "PERSON",
    re: new RegExp(`(${NAME_LATIN})[ \\t]*<[ \\t]*[^<>\\s@]+@`, "g"),
    group: 1,
    score: 0.85,
  },
  {
    rule: "person.salutation",
    cls: "PERSON",
    re: new RegExp(
      `(?<![A-Za-z])(?:${["dear", "hello", "hi", "namaste", "respected"].map(ci).join("|")})[ \\t]+(?:(?:Mr|Mrs|Ms|Dr|Shri|Smt)\\.?[ \\t]+)?(${NAME_LATIN})[ \\t]*[,!]`,
      "g",
    ),
    group: 1,
    validate: (v) => !SALUTATION_STOP.test(v),
    score: 0.8,
  },
  {
    rule: "person.signoff",
    cls: "PERSON",
    re: new RegExp(
      `(?<![A-Za-z])(?:${["regards", "warm regards", "thanks", "thank you", "sincerely", "yours sincerely", "yours faithfully", "yours truly"].map(ci).join("|")})[,.!]?[ \\t]*\\n[ \\t]*(${NAME_LATIN2})(?=[ \\t]*(?:\\n|$))`,
      "g",
    ),
    group: 1,
    score: 0.8,
  },
  {
    // NPCI/bank narrations: "UPI/DR/412345678901/RAVI KUMAR/okaxis/…", "NEFT/CR/N123456789/ASHA RAO/…".
    rule: "person.narration",
    cls: "PERSON",
    re: /\b(?:UPI|IMPS|NEFT|RTGS)\/(?:(?:DR|CR|P2A|P2M)\/)?[A-Z0-9]{6,22}\/([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*){0,3})\//g,
    group: 1,
    score: 0.85,
  },
  {
    // A name directly followed by a mobile number: "Madhav Deshmukh · 98765 43210".
    rule: "person.before_phone",
    cls: "PERSON",
    re: new RegExp(`(?<![A-Za-z])(${NAME_LATIN2})[ \\t]*[·|,–-][ \\t]*(?=${PHONE_AHEAD})`, "g"),
    group: 1,
    validate: (v) => !ADDRESS_HEADING.test(v),
    score: 0.7,
  },
  {
    rule: "address.label",
    cls: "ADDRESS",
    re: /(?:(?<![A-Za-z])(?:address|addr\.?)|पता)[ \t]*[:：\-–]?[ \t]+(.{8,160}?)(?=\s*,?\s*(?:IFSC|PAN|GSTIN|Aadhaar|email|mobile|account|phone|applicant|date of birth)\b|\s*[.\n]|$)/gi,
    group: 1,
    score: 0.8,
  },
];

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Orissa", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh", "Andaman and Nicobar",
  "Lakshadweep", "Dadra and Nagar Haveli", "Daman and Diu",
  "महाराष्ट्र", "उत्तर प्रदेश", "बिहार", "राजस्थान", "मध्य प्रदेश", "गुजरात", "दिल्ली", "पंजाब", "हरियाणा", "कर्नाटक", "केरल",
  "तमिलनाडु", "पश्चिम बंगाल", "झारखंड", "ओडिशा", "असम", "उत्तराखंड", "छत्तीसगढ़", "तेलंगाना",
];
const STATE_RE = new RegExp(`(?<![A-Za-z${DEV}])(?:${STATES.join("|")})(?![A-Za-z${DEV}])`);
const STREET_RE = new RegExp(
  `(?<![A-Za-z])(?:Road|Rd\\.?|Street|St\\.|Marg|Nagar|Lane|Colony|Sector|Chowk|Layout|Peth|Bazaa?r|Gall?i|Cross|Block|Phase|Apartments?|Apts?\\.?|Society|Enclave|Vihar|Puram|Extension|Tower|Floor|Near|Opp\\.?|Opposite|Behind|Village|Vill\\.|Taluka|Tehsil|Dist\\.|District|Mandal|Ward|Plot|Flat|Bhawan|Niwas|Sadan|Kunj|Residency|Heights|Chawl|Wadi|Pally|Para)(?![A-Za-z])|(?:मार्ग|नगर|गली|चौक|रोड|मोहल्ला|गाँव|ग्राम|पोस्ट|जिला|तहसील|कॉलोनी|सेक्टर|वार्ड|मकान)`,
);
const HOUSE_RE = /^\s*(?:(?:Flat|House|H|Plot|Door|Shop|Qtr|Room)\.?\s*(?:No\.?)?\s*[:#-]?\s*)?#?\s*[A-Z]?-?\d{1,4}[A-Z]?(?:[/-]\d{1,4}[A-Z]?)*\s*,/;
const PIN_RE = /(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)/;
const NOT_ADDRESS_LINE = /₹|\bRs\.|\bINR\b|@|https?:/;
const ADDRESS_HEADING = /\b(?:Address|Shipping|Billing|Delivery|Deliver|Contact|Details|Permanent|Correspondence|Residential|Office|Emergency|Account|Statement|Invoice|Order|Record|Profile|Summary|Settings)\b/;
const NAME_LINE = new RegExp(`^[ \\t]*(${NAME_LATIN2}|${NAME_DEV})[ \\t]*$`);
const EMAIL_LINE = /^[ \t]*[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[ \t]*$/;

interface Line {
  start: number;
  end: number;
  text: string;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const part of text.split("\n")) {
    out.push({ start, end: start + part.length, text: part });
    start += part.length + 1;
  }
  return out;
}

function trimmedSpan(l: Line, cls: PiiClass, rule: string, score: number): Span | null {
  const lead = l.text.length - l.text.trimStart().length;
  const body = l.text.trim();
  return body ? { start: l.start + lead, end: l.start + lead + body.length, cls, score, rule } : null;
}

/**
 * Layout conventions that no single-line regex sees: postal address blocks (street / state / PIN
 * spread over lines, often with no label), the name line that heads such a block, and a name line
 * directly above an email address, as in contact cards and inbox lists.
 */
function structuralSpans(text: string): Span[] {
  const ls = lines(text);
  const out: Span[] = [];
  const signals = ls.map((l) => {
    if (l.text.length > 120 || NOT_ADDRESS_LINE.test(l.text)) return 0;
    return (STATE_RE.test(l.text) ? 1 : 0) | (STREET_RE.test(l.text) ? 2 : 0) | (HOUSE_RE.test(l.text) ? 4 : 0) | (PIN_RE.test(l.text) ? 8 : 0);
  });
  for (let i = 0; i < ls.length; ) {
    if (!signals[i]) {
      i++;
      continue;
    }
    let j = i;
    let mask = 0;
    let signalLines = 0;
    while (j < ls.length) {
      if (signals[j]) {
        mask |= signals[j]!;
        signalLines++;
        j++;
      } else if (j + 1 < ls.length && signals[j + 1] && ls[j]!.text.trim().length <= 40 && !NAME_LINE.test(ls[j]!.text)) {
        j++; // a bare city line between two address lines
      } else break;
    }
    const kinds = [1, 2, 4, 8].filter((b) => mask & b).length;
    if (kinds >= 2 && (mask & 3) !== 0 && (signalLines >= 2 || kinds >= 3)) {
      const first = ls[i]!;
      const last = ls[j - 1]!;
      const block: Line = { start: first.start, end: last.end, text: text.slice(first.start, last.end) };
      const s = trimmedSpan(block, "ADDRESS", "address.block", 0.7);
      if (s) out.push(s);
      const head = ls[i - 1];
      if (head && NAME_LINE.test(head.text) && !ADDRESS_HEADING.test(head.text)) {
        const p = trimmedSpan(head, "PERSON", "person.addressee", 0.7);
        if (p) out.push(p);
      }
    }
    i = j;
  }
  for (let i = 0; i + 1 < ls.length; i++) {
    const l = ls[i]!;
    if (NAME_LINE.test(l.text) && !ADDRESS_HEADING.test(l.text) && EMAIL_LINE.test(ls[i + 1]!.text)) {
      const p = trimmedSpan(l, "PERSON", "person.contact_card", 0.7);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Capitalised words that follow a given name in shop, place and UI names, never in a person's name. */
const NOT_SURNAME = new Set(
  `road street marg nagar colony lane sector chowk services home details status traders enterprises hospital school college
  bank express travels motors stores store agency industries limited ltd pvt private group foundation trust society clinic
  medical pharmacy academy institute university temple masjid church market mall tower park garden hotel restaurant cafe
  kitchen foods dairy textiles jewellers electronics solutions technologies systems consultancy associates brothers sons co
  company account settings profile dashboard inbox sent drafts archive starred compose reply help support login logout register
  search menu next back submit cancel save edit delete update download upload share print view more less nagar vihar bhawan
  hall centre center office station airport junction layout apartments residency heights enclave camp cross circle bazar bazaar`.split(/\s+/),
);

const CAP_WORD = /^[A-Z](?:[a-z'’-]*|[A-Z'’-]*)\.?$/;
const INITIAL = /^[A-Z]\.$/;

/**
 * Names without a label: runs of capitalised words (Title Case or ALL CAPS, initials allowed) checked
 * against a gazetteer of Indian given names and surnames. Needs two name words, or initials plus a
 * name word; a lone given name counts only when it is the whole line (sidebars, cells, headings).
 */
function gazetteerSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const l of lines(text)) {
    if (l.text.length > 400) continue;
    const words = [...l.text.matchAll(/[A-Za-z][A-Za-z'’-]*\.?/g)].map((m) => ({ w: m[0], s: m.index!, e: m.index! + m[0].length }));
    const runs: Array<typeof words> = [];
    let run: typeof words = [];
    for (const w of words) {
      const prev = run[run.length - 1];
      const joined = prev && /^[ \t]*$/.test(l.text.slice(prev.e, w.s));
      if (!CAP_WORD.test(w.w)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      if (!joined && run.length) {
        runs.push(run);
        run = [];
      }
      run.push(w);
    }
    if (run.length) runs.push(run);
    const lineBody = l.text.trim().replace(/[,.;:!]+$/, "");
    for (const r of runs) {
      const kinds = r.map(({ w }) => {
        if (INITIAL.test(w)) return "I";
        const key = w.replace(/\.$/, "").replace(/’/g, "'").toLowerCase();
        return GIVEN_NAMES.has(key) ? "G" : SURNAME_SET.has(key) ? "S" : "U";
      });
      const standalone = lineBody === l.text.slice(r[0]!.s, r[r.length - 1]!.e).replace(/[,.;:!]+$/, "");
      for (let i = 0; i < r.length; ) {
        if (kinds[i] === "U") {
          i++;
          continue;
        }
        let j = i;
        while (j < r.length && kinds[j] !== "U") j++;
        let end = j;
        const sub = kinds.slice(i, j);
        const g = sub.filter((k) => k === "G").length;
        const named = sub.filter((k) => k !== "I").length;
        const initials = sub.filter((k) => k === "I").length;
        let score = 0;
        if (g >= 1 && named >= 2) score = 0.65;
        else if (initials >= 1 && named >= 1 && sub[0] === "I") score = 0.65;
        else if (standalone && g >= 1 && named === 1 && i === 0) {
          const next = r[j];
          if (!next) score = 0.55;
          else if (j === r.length - 1 && !NOT_SURNAME.has(next.w.replace(/\.$/, "").toLowerCase())) {
            score = 0.55;
            end = j + 1;
          }
        }
        if (score && !(initials === sub.length)) {
          const s = l.start + r[i]!.s;
          const e = l.start + r[end - 1]!.e - (r[end - 1]!.w.endsWith(".") && !INITIAL.test(r[end - 1]!.w) ? 1 : 0);
          out.push({ start: s, end: e, cls: "PERSON", score, rule: "person.gazetteer" });
        }
        i = j;
      }
    }
  }
  return out;
}

const DEVANAGARI_DIGIT_0 = 0x0966;

/** Maps Devanagari digits to ASCII without changing string length, so offsets stay valid. */
export function normalizeDigits(text: string): string {
  return text.replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - DEVANAGARI_DIGIT_0));
}

export interface DetectOptions {
  /** Classes to skip entirely. */
  exclude?: ReadonlySet<PiiClass>;
  /** Extra spans (e.g. from a local NER model) merged with rule output. */
  extra?: Span[];
}

export function detectRaw(text: string): Span[] {
  const norm = normalizeDigits(text);
  const out: Span[] = [];
  for (const r of RULES) {
    const re = new RegExp(r.re.source, r.re.flags.includes("d") ? r.re.flags : r.re.flags + "d");
    for (const m of norm.matchAll(re)) {
      const idx = m.indices?.[r.group ?? 0];
      if (!idx) continue;
      let [start, end] = idx;
      const value = norm.slice(start, end);
      const trimmed = value.replace(/[\s,.;:]+$/, "");
      end = start + trimmed.length;
      if (end <= start) continue;
      if (r.validate && !r.validate(trimmed)) continue;
      if (r.context) {
        const matchStart = m.index ?? start;
        const win = norm.slice(Math.max(0, matchStart - (r.contextWindow ?? 48)), matchStart);
        if (!r.context.test(win)) continue;
      }
      out.push({ start, end, cls: r.cls, score: r.score, rule: r.rule });
    }
  }
  out.push(...structuralSpans(norm), ...gazetteerSpans(norm));
  return out;
}

/**
 * Highest score wins; ties go to the longer span. A lower-scored span is not dropped but split
 * around the winners, so "Address: 12 MG Road, PIN 560001" keeps both the address and the PIN.
 * Output is sorted and non-overlapping.
 */
export function resolveOverlaps(spans: Span[], text?: string): Span[] {
  const sorted = [...spans].sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start));
  const kept: Span[] = [];
  for (const s of sorted) {
    let pieces: Array<[number, number]> = [[s.start, s.end]];
    for (const k of kept) {
      pieces = pieces.flatMap(([a, b]): Array<[number, number]> => {
        if (b <= k.start || a >= k.end) return [[a, b]];
        const out: Array<[number, number]> = [];
        if (a < k.start) out.push([a, k.start]);
        if (b > k.end) out.push([k.end, b]);
        return out;
      });
    }
    for (let [a, b] of pieces) {
      if (text) {
        while (a < b && /[\s,.;:()\-–]/.test(text[a]!)) a++;
        while (b > a && /[\s,.;:()\-–]/.test(text[b - 1]!)) b--;
      }
      // A fragment of a split span must still be meaningful, or it would mask stray punctuation.
      if (b - a >= 3 || (a === s.start && b === s.end)) kept.push({ ...s, start: a, end: b });
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

export function detect(text: string, opts: DetectOptions = {}): Span[] {
  let spans = detectRaw(text);
  if (opts.extra) spans = spans.concat(opts.extra);
  if (opts.exclude) spans = spans.filter((s) => !opts.exclude!.has(s.cls));
  return resolveOverlaps(spans, text);
}
