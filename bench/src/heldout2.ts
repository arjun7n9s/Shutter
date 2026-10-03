/**
 * Second blind held-out corpus for the privacy-redaction benchmark.
 *
 * Site types, layouts and wordings are intentionally different from generate.ts and heldout.ts
 * so detectors tuned on those corpora are scored on genuine generalisation.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fakeAadhaar,
  fakeCard,
  fakeGstin,
  fakeIfsc,
  fakeMobile,
  fakePan,
  fakePincode,
  fakeVid,
  mulberry32,
  pick,
} from "@parda/core";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "corpus", "heldout2");
const N = 64;
const SEED = 4242;

type Rng = () => number;
type PiiClass =
  | "PERSON"
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "AADHAAR_VID"
  | "PAN"
  | "GSTIN"
  | "IFSC"
  | "BANK_ACCOUNT"
  | "CARD"
  | "CARD_CVV"
  | "CARD_EXPIRY"
  | "UPI"
  | "DOB"
  | "ADDRESS"
  | "PINCODE"
  | "PASSPORT"
  | "VOTER_ID"
  | "DRIVING_LICENCE"
  | "OTP"
  | "PASSWORD"
  | "USERNAME"
  | "IP_ADDRESS"
  | "SECRET"
  | "FACE"
  | "QR"
  | "OPAQUE";

interface Profile {
  name: string;
  email: string;
  mobile: string;
  aadhaar: string;
  vid: string;
  pan: string;
  dob: string;
  house: string;
  street: string;
  city: string;
  state: string;
  address: string;
  pincode: string;
  account: string;
  ifsc: string;
  upi: string;
  card: string;
  gstin: string;
  passport: string;
  voterId: string;
  drivingLicence: string;
  username: string;
  password: string;
  ip: string;
}

/** Distinct from generate.ts / heldout.ts — regional mix + initials + single-word. */
const FIRST = [
  "Anirudh",
  "Shreya",
  "Parthiban",
  "Binalakshmi",
  "Lalremsiama",
  "Venkatesh",
  "Padmavathi",
  "Soumya",
  "Rituparna",
  "Deepayan",
  "Jasleen",
  "Harmanpreet",
  "Bikramjit",
  "Salman",
  "Yasmeen",
  "Feroze",
  "Zainab",
  "Mathew",
  "Agnes",
  "Cyril",
  "Theresa",
  "Srinivasan",
  "Moirangthem",
  "Chinglen",
];
const LAST = [
  "Subramaniam",
  "Nambiar",
  "Chakraborty",
  "Mukherjee",
  "Bhattacharya",
  "Sandhu",
  "Brar",
  "Dhillon",
  "Ansari",
  "Siddiqui",
  "D'Souza",
  "Pereira",
  "Lalhriatpuia",
  "Sangma",
  "Thapa",
  "Gogoi",
  "Hegde",
  "Shetty",
  "Krishnan",
  "Vaishnav",
];
/** Display forms including initials-first and single-word names. */
const NAME_FORMS = [
  "plain",
  "plain",
  "plain",
  "initials",
  "double_initials",
  "single",
] as const;
const LOCATIONS = [
  ["Coimbatore", "Tamil Nadu", "RS Puram"],
  ["Thrissur", "Kerala", "Punkunnam"],
  ["Shillong", "Meghalaya", "Laitumkhrah"],
  ["Imphal", "Manipur", "Thangal Bazaar"],
  ["Howrah", "West Bengal", "Shibpur"],
  ["Amritsar", "Punjab", "Lawrence Road"],
  ["Hyderabad", "Telangana", "Banjara Hills"],
  ["Mangaluru", "Karnataka", "Kadri"],
] as const;
const EMAIL_DOMAINS = ["campusmail.edu.in", "workmail.co.in", "netpost.in", "indiamail.org"];
const PSP = ["oksbi", "ybl", "axl", "paytm", "okhdfcbank", "ibl"];
const STATE_CODES = ["TN", "KL", "ML", "MN", "WB", "PB", "TS", "KA"];

const digits = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");
const nonZeroDigits = (rng: Rng, n: number): string =>
  `${1 + Math.floor(rng() * 9)}${digits(rng, n - 1)}`;
const letters = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => pick(rng, "ABCDEFGHJKLMNPQRSTUVWXYZ".split(""))).join("");
const token = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () =>
    pick(rng, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("")),
  ).join("");

function makeName(rng: Rng): string {
  const first = pick(rng, FIRST);
  const last = pick(rng, LAST);
  const form = pick(rng, NAME_FORMS);
  if (form === "single") return pick(rng, ["Santosh", "Mamta", "Prakash", "Sunita", "Ramesh"]);
  if (form === "initials") return `${first.slice(0, 1)}. ${last}`;
  if (form === "double_initials") {
    const mid = pick(rng, ["S", "V", "R", "K", "M", "P"]);
    return `${first.slice(0, 1)}. ${mid}. ${last}`;
  }
  return `${first} ${last}`;
}

function profile(rng: Rng): Profile {
  const name = makeName(rng);
  const [city, state, street] = pick(rng, LOCATIONS);
  const house = `${1 + Math.floor(rng() * 498)}${pick(rng, ["", "", "A", "B"])}`;
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const year = 1958 + Math.floor(rng() * 48);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 10);
  const username = `${slug}${digits(rng, 3)}`;
  return {
    name,
    email: `${slug}${digits(rng, 2)}@${pick(rng, EMAIL_DOMAINS)}`,
    mobile: fakeMobile(rng),
    aadhaar: fakeAadhaar(rng),
    vid: fakeVid(rng),
    pan: fakePan(rng),
    dob: `${day}/${month}/${year}`,
    house,
    street,
    city,
    state,
    address: `${house}, ${street}, ${city}, ${state}`,
    pincode: fakePincode(rng),
    account: nonZeroDigits(rng, 14),
    ifsc: fakeIfsc(rng),
    upi: `${slug}${digits(rng, 2)}@${pick(rng, PSP)}`,
    card: fakeCard(rng, pick(rng, ["4", "5", "6"])),
    gstin: fakeGstin(rng),
    passport: `${pick(rng, ["A", "B", "C", "E", "H", "J"])}${nonZeroDigits(rng, 7)}`,
    voterId: `${letters(rng, 3)}${nonZeroDigits(rng, 7)}`,
    drivingLicence: `${pick(rng, STATE_CODES)}${String(1 + Math.floor(rng() * 40)).padStart(2, "0")}${2010 + Math.floor(rng() * 15)}${nonZeroDigits(rng, 7)}`,
    username,
    password: `${pick(rng, ["Cascade", "Nilgiri", "Teakwood", "Jasmine"])}#${digits(rng, 4)}`,
    ip: `10.${20 + Math.floor(rng() * 180)}.${1 + Math.floor(rng() * 253)}.${1 + Math.floor(rng() * 253)}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const gt = (cls: PiiClass, value: string): string =>
  `<span data-gt="${cls}">${escapeHtml(value)}</span>`;
const spaced = (value: string): string => value.replace(/(\d{4})(?=\d)/g, "$1 ");
const cardSpaced = (value: string): string => value.replace(/(\d{4})(?=\d)/g, "$1 ");
const money = (value: number): string =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function inputField(label: string, value: string, cls: PiiClass, type = "text"): string {
  return `<div class="field"><label>${label}</label><input type="${type}" value="${escapeHtml(value)}" data-gt="${cls}" readonly></div>`;
}

const FACE_URI = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="112" viewBox="0 0 96 112"><rect width="96" height="112" rx="8" fill="#e2e8f0"/><circle cx="48" cy="40" r="22" fill="#c4a484"/><path d="M18 108c2-28 14-42 30-42s28 14 30 42" fill="#3d5a73"/><circle cx="40" cy="40" r="2" fill="#222"/><circle cx="56" cy="40" r="2" fill="#222"/></svg>`,
)}`;

const CSS = `
*{box-sizing:border-box} body{margin:0;font:14px/1.45 "Segoe UI",Arial,"Nirmala UI",sans-serif;color:#1a2332;background:#eef1f6}
header{background:#163a5f;color:#fff;padding:10px 28px;display:flex;justify-content:space-between;align-items:center}
header b{font-size:18px} nav a{color:#c9daf0;margin-left:16px;text-decoration:none;font-size:13px}
main{max-width:1200px;margin:12px auto;background:#fff;border:1px solid #d2d8e4;border-radius:6px;padding:16px 22px}
h1{font-size:20px;margin:0 0 8px} h2{font-size:15px;margin:12px 0 6px;color:#163a5f}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px}
.field label{display:block;font-size:12px;color:#4a5568;margin-bottom:2px}
.field input,.field select,.field textarea{width:100%;padding:6px 8px;border:1px solid #b8c2d4;border-radius:4px;font:inherit}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #d9dee8;padding:5px 7px;text-align:left;font-size:13px}
th{background:#eef2f9} .muted{color:#6b7280;font-size:12px}
button{background:#163a5f;color:#fff;border:0;border-radius:4px;padding:7px 14px;font:inherit;margin-right:6px}
button.alt{background:#e8edf6;color:#163a5f} p{margin:5px 0}
`;

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style>${extraHead}</head>
<body><header><b>${title}</b><nav><a href="#">Home</a><a href="#">Services</a><a href="#">Track status</a><a href="#">Help</a></nav></header><main>${body}</main></body></html>`;
}

const H2_CSS = `<style>
.badge{display:inline-block;padding:2px 7px;border-radius:4px;background:#e7f5ee;color:#1a6b3c;font-size:11px}
.mark-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #163a5f;padding-bottom:8px;margin-bottom:10px}
.mark-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 14px;margin:8px 0 10px}
.mark-meta dt{color:#657083;font-size:12px}.mark-meta dd{margin:0;font-weight:600}
.marks td:nth-child(n+3){text-align:right}
.pol-banner{background:#f0f5fb;border:1px solid #c5d3e6;border-radius:6px;padding:10px 12px;display:flex;justify-content:space-between;margin-bottom:10px}
.pol-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.pol-box{border:1px solid #d5dde8;border-radius:6px;padding:10px;background:#fafbfd}
.pol-box h3{margin:0 0 6px;font-size:13px;color:#4a5568;text-transform:uppercase;letter-spacing:.04em}
.chat-shell{display:grid;grid-template-columns:220px 1fr;height:620px;border:1px solid #cfd6e2;border-radius:8px;overflow:hidden}
.chat-list{background:#f0f2f5;padding:8px;border-right:1px solid #d5dbe6;overflow:hidden}
.chat-item{padding:8px;border-radius:6px;margin-bottom:4px;background:#fff;font-size:13px}
.chat-item.active{background:#d9fdd3}.chat-item small{display:block;color:#667}.chat-main{display:flex;flex-direction:column;background:#efeae2}
.chat-top{background:#f0f2f5;padding:8px 12px;border-bottom:1px solid #d5dbe6;font-weight:600}
.chat-thread{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
.bubble{max-width:72%;padding:8px 11px;border-radius:8px;font-size:13.5px;line-height:1.45;box-shadow:0 1px 1px rgba(0,0,0,.06)}
.bubble.in{align-self:flex-start;background:#fff}.bubble.out{align-self:flex-end;background:#d9fdd3}
.bubble .t{float:right;margin:4px 0 0 10px;font-size:10px;color:#667}
.receipt{border:1px dashed #9aa8bc;padding:14px 16px;background:#fffcf5}
.receipt h1{font-size:18px;text-align:center;margin-bottom:4px}.receipt .org{text-align:center;color:#4a5568;margin-bottom:10px}
.receipt-para{line-height:1.65;font-size:14px}
.resume{display:grid;grid-template-columns:110px 1fr;gap:16px;align-items:start}
.resume img{width:96px;height:112px;object-fit:cover;border-radius:4px;border:1px solid #ccd}
.resume h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}.contact-line{color:#334;font-size:14px;margin-bottom:8px}
.resume-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}.skill-chips span{display:inline-block;background:#eef2f7;padding:3px 8px;margin:2px;border-radius:3px;font-size:12px}
.courier{display:grid;grid-template-columns:1fr 1fr;gap:14px}.party{border:1px solid #d0d7e3;border-radius:6px;padding:12px;background:#f8fafc}
.party .lbl{font-size:11px;text-transform:uppercase;color:#5a6578;margin-bottom:4px;letter-spacing:.05em}
.track-bar{display:flex;gap:6px;margin:10px 0}.track-bar span{flex:1;text-align:center;background:#edf1f7;padding:6px;border-radius:4px;font-size:11px}.track-bar span.on{background:#163a5f;color:#fff}
.fee-layout{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
.saved-card{display:flex;justify-content:space-between;align-items:center;border:1px solid #d5dde8;border-radius:5px;padding:7px 10px;margin-bottom:6px;background:#fafbfd;font-family:Consolas,monospace;font-size:13px}
.crm-filters{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.crm-filters input,.crm-filters select{padding:5px 8px;border:1px solid #b8c2d4;border-radius:4px;font:inherit}
.crm-pager{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:12px;color:#566}
.crm-table td:nth-child(5),.crm-table td:nth-child(6){text-align:right;font-variant-numeric:tabular-nums}
</style>`;

interface TemplateResult {
  title: string;
  html: string;
  tags: string[];
}
type Template = (rng: Rng, p: Profile, qr: string) => TemplateResult;

const templates: Record<string, Template> = {
  /** (1) University exam result / marksheet */
  university_exam_result: (rng, p) => {
    const father = makeName(rng);
    const roll = `URN${2019 + Math.floor(rng() * 7)}${nonZeroDigits(rng, 6)}`;
    const regNo = `REG/${digits(rng, 4)}/${nonZeroDigits(rng, 5)}`;
    const subjects = [
      ["CS401", "Operating Systems", 42 + Math.floor(rng() * 50), 18 + Math.floor(rng() * 20)],
      ["CS402", "Database Systems", 40 + Math.floor(rng() * 52), 16 + Math.floor(rng() * 22)],
      ["MA301", "Discrete Mathematics", 38 + Math.floor(rng() * 48), 15 + Math.floor(rng() * 20)],
      ["HS210", "Professional Ethics", 45 + Math.floor(rng() * 40), 17 + Math.floor(rng() * 18)],
      ["CS403", "Computer Networks", 41 + Math.floor(rng() * 45), 19 + Math.floor(rng() * 19)],
    ];
    const sgpa = (7 + rng() * 2.4).toFixed(2);
    return {
      title: "State Technical University — Result Portal",
      html: `<!-- Roll / registration / subject codes / marks / SGPA are academic decoys, not GT. -->
<div class="mark-head"><div><h1>Semester Grade Card</h1><span class="badge">PROVISIONAL</span></div>
<div class="muted">Exam session May 2026<br>Result ID RST-${digits(rng, 9)}</div></div>
<dl class="mark-meta">
<dt>Candidate</dt><dd>${gt("PERSON", p.name)}</dd>
<dt>Father's name</dt><dd>${gt("PERSON", father)}</dd>
<dt>Date of birth</dt><dd>${gt("DOB", p.dob)}</dd>
<dt>Programme</dt><dd>B.E. Computer Science</dd>
<dt>University roll no.</dt><dd>${roll}</dd>
<dt>Registration no.</dt><dd>${regNo}</dd>
<dt>College code</dt><dd>STU-${digits(rng, 4)}</dd>
<dt>Medium</dt><dd>English</dd>
</dl>
<table class="marks"><tr><th>Code</th><th>Subject</th><th>Internal</th><th>External</th><th>Total</th><th>Grade</th></tr>
${subjects
  .map((s) => {
    const total = (s[2] as number) + (s[3] as number);
    const grade = total >= 90 ? "O" : total >= 75 ? "A+" : total >= 60 ? "A" : "B+";
    return `<tr><td>${s[0]}</td><td>${s[1]}</td><td>${s[2]}</td><td>${s[3]}</td><td>${total}</td><td>${grade}</td></tr>`;
  })
  .join("")}</table>
<p><b>SGPA ${sgpa}</b> · Credits earned 22 · Rank in class ${1 + Math.floor(rng() * 80)} · Batch strength 120</p>
<p class="muted">Published 12 Jun 2026 · Verification hash ${letters(rng, 4)}${digits(rng, 8)} · Not a migration certificate</p>
<p><button>Download PDF</button><button class="alt">Apply for revaluation</button></p>`,
      tags: ["academic", "table", "roll-decoy"],
    };
  },

  /** (2) Insurance policy / claim page */
  insurance_policy_claim: (rng, p) => {
    const nominee = makeName(rng);
    const policyNo = `HLTH/${digits(rng, 4)}/${nonZeroDigits(rng, 8)}`;
    const claimNo = `CLM${nonZeroDigits(rng, 10)}`;
    const sumAssured = 300000 + Math.floor(rng() * 700000);
    return {
      title: "SurakshaShield Policy & Claim Desk",
      html: `<!-- Policy / claim / hospital / amount fields are product decoys. -->
<div class="pol-banner"><div><h1>Cashless claim status</h1><span class="muted">Policy ${policyNo}</span></div>
<div><span class="badge">Under review</span><br><span class="muted">Claim ${claimNo}</span></div></div>
<div class="pol-grid">
<div class="pol-box"><h3>Policyholder</h3>
<p>${gt("PERSON", p.name)}<br>DOB ${gt("DOB", p.dob)}<br>Mob. ${gt("PHONE", `+91 ${p.mobile}`)}<br>${gt("EMAIL", p.email)}</p>
<p class="muted">Member ID MEM-${digits(rng, 7)}</p></div>
<div class="pol-box"><h3>Nominee</h3>
<p>${gt("PERSON", nominee)} · Relation: Spouse<br>Contact ${gt("PHONE", `+91 ${fakeMobile(rng)}`)}</p>
<p class="muted">Nomination dated 14 Mar 2024</p></div>
<div class="pol-box"><h3>Settlement bank</h3>
<p>A/c ${gt("BANK_ACCOUNT", p.account)}<br>IFSC ${gt("IFSC", p.ifsc)}<br>PAN ${gt("PAN", p.pan)}</p>
<p class="muted">NEFT only · T+3 working days</p></div>
</div>
<h2>Hospitalisation</h2>
<table><tr><th>Hospital</th><th>Admission</th><th>Discharge</th><th>Bill no.</th><th>Claimed</th><th>Approved</th></tr>
<tr><td>City Care Multispecialty</td><td>03 Sep 2026</td><td>07 Sep 2026</td><td>HB-${nonZeroDigits(rng, 8)}</td><td>₹${money(84250)}</td><td>₹${money(76120)}</td></tr></table>
<p class="muted">Sum insured ₹${money(sumAssured)} · Room rent cap ₹4,500/day · Pre-auth ${digits(rng, 6)} · ICD J18.9</p>
<p><button>Upload documents</button><button class="alt">Track settlement</button></p>`,
      tags: ["insurance", "finance", "claim"],
    };
  },

  /** (3) WhatsApp-Web-like chat — free-text PII in bubbles */
  whatsapp_chat_thread: (rng, p) => {
    const peer = makeName(rng);
    const peer2 = makeName(rng);
    const otp = nonZeroDigits(rng, 6);
    const shareAddr = `${p.house}, ${p.street}, ${p.city}`;
    return {
      title: "ChatterWeb",
      html: `<!-- Chat UI: PII appears only inside free-text bubbles (no field labels). Group/order IDs are decoys. -->
<div class="chat-shell">
<aside class="chat-list">
<div class="chat-item active"><b>${gt("PERSON", peer)}</b><small>typing…</small></div>
<div class="chat-item"><b>${gt("PERSON", peer2)}</b><small>Yesterday</small></div>
<div class="chat-item"><b>Hostel Mess Group</b><small>Order #${nonZeroDigits(rng, 8)}</small></div>
<div class="chat-item"><b>Campus Notices</b><small>Event code EV-${digits(rng, 5)}</small></div>
</aside>
<section class="chat-main">
<div class="chat-top">${gt("PERSON", peer)} <span class="muted">· online</span></div>
<div class="chat-thread">
<div class="bubble in">Hey, can you call me on ${gt("PHONE", `+91 ${p.mobile}`)} after class?<span class="t">10:12</span></div>
<div class="bubble out">Sure — also send the delivery spot<span class="t">10:13</span></div>
<div class="bubble in">Drop at ${gt("ADDRESS", shareAddr)}. PIN is nearby, ask the watchman for flat ${p.house}.<span class="t">10:14</span></div>
<div class="bubble out">Paying via ${gt("UPI", p.upi)} — confirm when it lands<span class="t">10:15</span></div>
<div class="bubble in">OTP for the locker is ${gt("OTP", otp)}. Don't forward it.<span class="t">10:16</span></div>
<div class="bubble out">Got it. Ref ${nonZeroDigits(rng, 10)} on the receipt.<span class="t">10:17</span></div>
<div class="bubble in">My other number if this one's busy: ${gt("PHONE", `+91 ${fakeMobile(rng)}`)}<span class="t">10:18</span></div>
</div>
</section>
</div>`,
      tags: ["chat", "free-text", "otp", "upi"],
    };
  },

  /** (4) Property-tax / municipal receipt — address in a paragraph */
  property_tax_receipt: (rng, p) => {
    const receiptNo = `PTR/${2026}/${nonZeroDigits(rng, 7)}`;
    const assessment = `PID-${nonZeroDigits(rng, 9)}`;
    const amount = 2400 + Math.floor(rng() * 18000);
    return {
      title: "Nagar Nigam e-Receipt",
      html: `<!-- Assessment ID, receipt no., ward, amounts, due dates are municipal decoys. -->
<div class="receipt">
<h1>Property Tax Payment Receipt</h1>
<div class="org">${p.city} Municipal Corporation · Ward ${10 + Math.floor(rng() * 40)}</div>
<p class="muted" style="text-align:center">Receipt ${receiptNo} · Assessment ${assessment} · FY 2026–27</p>
<p class="receipt-para">Received with thanks from <b>${gt("PERSON", p.name)}</b>, owner of the property situated at
${gt("ADDRESS", `${p.house}, ${p.street}, ${p.city}, ${p.state}`)}
${gt("PINCODE", p.pincode)},
a sum of <b>₹${money(amount)}</b> towards property tax for the half-year ending 30 Sep 2026.
Mobile registered for SMS alerts: ${gt("PHONE", `+91 ${p.mobile}`)}. Demand notice DN-${digits(rng, 8)} stands cleared.</p>
<table><tr><th>Head</th><th>Arrears</th><th>Current</th><th>Penalty</th><th>Total</th></tr>
<tr><td>General tax</td><td>₹0.00</td><td>₹${money(amount * 0.72)}</td><td>₹0.00</td><td>₹${money(amount * 0.72)}</td></tr>
<tr><td>Water & sewerage</td><td>₹0.00</td><td>₹${money(amount * 0.28)}</td><td>₹0.00</td><td>₹${money(amount * 0.28)}</td></tr>
</table>
<p class="muted">Transaction UTR ${nonZeroDigits(rng, 12)} · Paid on 18 Sep 2026 · Counter code ${digits(rng, 4)} · Plot area 1${digits(rng, 3)} sq.ft</p>
<p><button>Print</button><button class="alt">Email receipt</button></p>
</div>`,
      tags: ["municipal", "prose-address", "receipt"],
    };
  },

  /** (5) Job application / resume view */
  job_resume_view: (rng, p) => {
    const years = 2 + Math.floor(rng() * 12);
    return {
      title: "TalentBridge Candidate Profile",
      html: `<!-- Job IDs, years of experience, skill tags and notice periods are recruiting decoys. -->
<div class="resume">
<img data-gt="FACE" src="${FACE_URI}" alt="">
<div>
<h1>${gt("PERSON", p.name)}</h1>
<div class="contact-line">${gt("EMAIL", p.email)} &nbsp;|&nbsp; ${gt("PHONE", `+91 ${p.mobile}`)} &nbsp;|&nbsp; ${escapeHtml(p.city)}</div>
<p class="muted">Application APP-${digits(rng, 8)} · Role: Backend Engineer · Notice: ${15 + Math.floor(rng() * 45)} days · Exp. ${years} yrs</p>
</div>
</div>
<div class="resume-grid">
<section>
<h2>Experience</h2>
<p><b>Software Engineer</b> — Northwind Labs &nbsp;<span class="muted">2021 – Present · Emp. ID EMP${digits(rng, 5)}</span></p>
<p>Built payment settlement jobs processing ~${10 + Math.floor(rng() * 40)}k txns/day. Ticket backlog closed: ${digits(rng, 3)}.</p>
<p><b>Intern</b> — Deccan Soft &nbsp;<span class="muted">2020 · Project code PRJ-${digits(rng, 4)}</span></p>
<h2>Education</h2>
<p>B.Tech CSE · Batch ${2014 + Math.floor(rng() * 8)} · CGPA ${(7 + rng() * 2.5).toFixed(2)} · Roll ${nonZeroDigits(rng, 8)}</p>
</section>
<aside>
<h2>Skills</h2>
<div class="skill-chips"><span>TypeScript</span><span>Postgres</span><span>Kafka</span><span>Redis</span><span>Go</span></div>
<h2>Documents on file</h2>
<p>PAN ${gt("PAN", p.pan)}<br>Passport ${gt("PASSPORT", p.passport)}</p>
<p class="muted">Resume hash ${letters(rng, 6)}${digits(rng, 6)} · Source: career fair booth ${digits(rng, 3)}</p>
<p><button>Shortlist</button><button class="alt">Request references</button></p>
</aside>
</div>`,
      tags: ["resume", "face", "contact-line"],
    };
  },

  /** (6) Courier tracking — Hindi–English mixed labels */
  courier_tracking: (rng, p) => {
    const receiver = makeName(rng);
    const awb = `AWB${nonZeroDigits(rng, 11)}`;
    const recvAddr = `${1 + Math.floor(rng() * 200)}, ${pick(rng, ["Sector 14", "MG Extension", "Lake View Road"])}, ${pick(rng, LOCATIONS)[0]}`;
    return {
      title: "DootExpress Shipment Tracker",
      html: `<!-- AWB / weight / hub codes / ETA are logistics decoys. -->
<div class="track-bar"><span class="on">Booked</span><span class="on">In transit</span><span class="on">Out for delivery</span><span>Delivered</span></div>
<p><b>AWB ${awb}</b> · Weight ${(0.5 + rng() * 8).toFixed(2)} kg · Service: Surface · ETA 02 Oct 2026 · Hub ${digits(rng, 4)}</p>
<div class="courier">
<div class="party">
<div class="lbl">भेजने वाला / Sender</div>
<p><b>${gt("PERSON", p.name)}</b><br>${gt("ADDRESS", p.address)}<br>पिन ${gt("PINCODE", p.pincode)}<br>Mob. ${gt("PHONE", `+91 ${p.mobile}`)}</p>
</div>
<div class="party">
<div class="lbl">प्राप्तकर्ता / Prapt-karta</div>
<p><b>${gt("PERSON", receiver)}</b><br>${gt("ADDRESS", recvAddr)}<br>Contact No. ${gt("PHONE", `+91 ${fakeMobile(rng)}`)}<br>${gt("EMAIL", receiver.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8) + digits(rng, 2) + "@" + pick(rng, EMAIL_DOMAINS))}</p>
</div>
</div>
<h2>Scan history</h2>
<table><tr><th>Time</th><th>Location</th><th>Status code</th><th>Remarks</th></tr>
<tr><td>28 Sep 06:40</td><td>Origin hub ${p.city}</td><td>PKP</td><td>Shipment picked · Bag ${digits(rng, 6)}</td></tr>
<tr><td>29 Sep 14:10</td><td>Sort centre 5600${digits(rng, 2)}</td><td>ITR</td><td>In transit · Flight ${letters(rng, 2)}${digits(rng, 3)}</td></tr>
<tr><td>30 Sep 09:05</td><td>Delivery beat 12</td><td>OFD</td><td>Out for delivery · Agent ID AG-${digits(rng, 5)}</td></tr>
</table>
<p class="muted">COD amount ₹0.00 · Reference ${nonZeroDigits(rng, 10)} · Packaging type BOX</p>
<p><button>Share tracking</button><button class="alt">Raise dispute</button></p>`,
      tags: ["courier", "bilingual", "tracking"],
    };
  },

  /** (7) School fee portal — card form + masked saved cards */
  school_fee_portal: (rng, p) => {
    const child = makeName(rng);
    const expiry = `${String(1 + Math.floor(rng() * 12)).padStart(2, "0")}/${28 + Math.floor(rng() * 5)}`;
    const cvv = String(100 + Math.floor(rng() * 900));
    const fee = 18500 + Math.floor(rng() * 22000);
    const masked1 = `XXXX XXXX XXXX ${digits(rng, 4)}`;
    const masked2 = `XXXX XXXX XXXX ${p.card.slice(-4)}`;
    return {
      title: "VidyaFee Parent Portal",
      html: `<!-- Fee heads, admission nos., academic year and MASKED cards are not GT. -->
<div class="fee-layout">
<section>
<h1>Term fee payment</h1>
<p class="muted">Academic year 2026–27 · Admission no. ADM/${digits(rng, 6)} · Grade ${3 + Math.floor(rng() * 9)}</p>
<div class="grid" style="grid-template-columns:1fr 1fr">
${inputField("Parent / guardian", p.name, "PERSON")}
${inputField("Student name", child, "PERSON")}
${inputField("Registered mobile", `+91 ${p.mobile}`, "PHONE", "tel")}
${inputField("Fee email", p.email, "EMAIL", "email")}
</div>
<h2>Pay with card</h2>
<div class="grid" style="grid-template-columns:1fr 1fr 1fr">
${inputField("Card number", cardSpaced(p.card), "CARD")}
${inputField("Expiry", expiry, "CARD_EXPIRY")}
${inputField("CVV", cvv, "CARD_CVV", "password")}
</div>
<p><b>Amount due ₹${money(fee)}</b> · Late fee ₹0 · Receipt will be RF-${digits(rng, 8)}</p>
<p><button>Pay now</button><button class="alt">Pay via UPI later</button></p>
</section>
<aside>
<h2>Saved cards</h2>
<!-- Masked PANs intentionally omit data-gt. -->
<div class="saved-card"><span>${masked1}</span><span class="muted">Visa · default</span></div>
<div class="saved-card"><span>${masked2}</span><span class="muted">RuPay</span></div>
<p class="muted">School code SCH-${digits(rng, 5)} · Session token ${token(rng, 12)}</p>
<iframe class="opaque-frame" data-gt="OPAQUE" sandbox title="Fee gateway widget" style="width:100%;height:72px;border:1px solid #cfd7e3;border-radius:5px" srcdoc="<div style='font:12px Arial;padding:10px;color:#445'>Payment gateway status: ready<br>Merchant MID ${digits(rng, 8)}</div>"></iframe>
</aside>
</div>`,
      tags: ["school", "payment", "masked-card", "opaque"],
    };
  },

  /** (8) CRM / admin leads table with abbreviated headers */
  crm_leads_table: (rng, p) => {
    const leads = [p, profile(rng), profile(rng), profile(rng), profile(rng), profile(rng)];
    const stages = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];
    return {
      title: "LeadStack CRM — Pipeline",
      html: `<!-- Score / deal value / lead IDs / page counts are CRM decoys; Loc. city alone is not ADDRESS GT. -->
<div class="crm-filters">
<strong>Leads</strong>
<input placeholder="Filter by stage" value="">
<select><option>All owners</option><option>Unassigned</option></select>
<span class="muted">Pipeline FY26 · View: table</span>
<button>Export CSV</button>
</div>
<table class="crm-table"><tr><th>ID</th><th>Cust.</th><th>Ph.</th><th>Mail</th><th>Loc.</th><th>Score</th><th>Deal ₹</th><th>Stage</th></tr>
${leads
  .map((lead, i) => {
    const id = `L${nonZeroDigits(rng, 7)}`;
    const score = 20 + Math.floor(rng() * 80);
    const deal = (50000 + Math.floor(rng() * 900000)).toLocaleString("en-IN");
    return `<tr><td>${id}</td><td>${gt("PERSON", lead.name)}</td><td>${gt("PHONE", lead.mobile)}</td><td>${gt("EMAIL", lead.email)}</td><td>${escapeHtml(lead.city)}</td><td>${score}</td><td>${deal}</td><td>${stages[i % stages.length]}</td></tr>`;
  })
  .join("")}
</table>
<div class="crm-pager"><span>Showing 1–6 of 248 · Page size 25</span>
<span><button class="alt">Prev</button> Page 1 of 10 <button class="alt">Next</button></span></div>
<p class="muted">Last sync 30 Sep 2026 18:40 · Batch JOB-${digits(rng, 6)} · Non-PII ref ${nonZeroDigits(rng, 10)}</p>`,
      tags: ["crm", "table", "abbrev-headers", "pagination"],
    };
  },
};

async function main(): Promise<void> {
  const wasm = readFileSync(
    join(here, "..", "..", "node_modules", "zxing-wasm", "dist", "writer", "zxing_writer.wasm"),
  );
  await prepareZXingModule({
    overrides: {
      wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer,
    },
    fireImmediately: true,
  });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const rng = mulberry32(SEED);
  const names = Object.keys(templates);
  if (names.length !== 8) throw new Error(`Expected 8 templates, found ${names.length}`);

  const manifest: Array<{ file: string; template: string; tags: string[] }> = [];
  for (let index = 0; index < N; index++) {
    const templateName = names[index % names.length]!;
    const p = profile(rng);
    const payload = digits(rng, 300);
    const code = await writeBarcode(payload, { format: "QRCode", scale: 3 });
    const png = Buffer.from(await code.image!.arrayBuffer()).toString("base64");
    const result = templates[templateName]!(rng, p, `data:image/png;base64,${png}`);
    const file = `${String(index).padStart(3, "0")}_${templateName}.html`;
    writeFileSync(join(OUT, file), page(result.title, result.html, H2_CSS));
    manifest.push({ file, template: templateName, tags: result.tags });
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ seed: SEED, pages: manifest }, null, 2));
  console.log(`wrote ${N} pages to ${OUT}`);
}

await main();
