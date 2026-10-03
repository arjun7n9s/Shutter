/**
 * Independently designed held-out pages for the privacy-redaction benchmark.
 *
 * Visible sensitive values are annotated with data-gt. Unsupported identifiers and deliberate
 * decoys remain unlabelled so they measure precision rather than inflating ground truth.
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
const OUT = join(here, "..", "corpus", "heldout");
const N = 64;
const SEED = 90210;

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
  devName: string;
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

const FIRST = [
  "Ishaan",
  "Zoya",
  "Tanvi",
  "Devansh",
  "Madhav",
  "Noor",
  "Reyansh",
  "Ira",
  "Kabir",
  "Myra",
  "Aditya",
  "Sana",
  "Harini",
  "Nikhil",
  "Ayesha",
  "Tenzin",
  "Roshan",
  "Leela",
  "Bhavna",
  "Omkar",
];
const LAST = [
  "Bose",
  "Deshmukh",
  "Pillai",
  "Kapoor",
  "Sheikh",
  "Dutta",
  "Bhardwaj",
  "Saxena",
  "Fernandes",
  "Naidu",
  "Bhat",
  "Qureshi",
  "Ghosh",
  "Thomas",
  "Wagh",
  "Mirza",
];
const DEV_NAMES = [
  "आरती देशमुख",
  "नवीन सक्सेना",
  "शबाना ख़ान",
  "दीपक बिष्ट",
  "मंजू चौहान",
  "रोहित तिवारी",
  "सविता पाटिल",
  "इमरान अंसारी",
  "नेहा कश्यप",
  "गौरव मिश्रा",
];
const LOCATIONS = [
  ["Surat", "Gujarat", "Athwa Gate"],
  ["Mysuru", "Karnataka", "Vijayanagar 2nd Stage"],
  ["Nagpur", "Maharashtra", "Dharampeth"],
  ["Guwahati", "Assam", "Beltola Road"],
  ["Indore", "Madhya Pradesh", "Vijay Nagar"],
  ["Bhubaneswar", "Odisha", "Saheed Nagar"],
  ["Dehradun", "Uttarakhand", "Rajpur Road"],
  ["Visakhapatnam", "Andhra Pradesh", "MVP Colony"],
] as const;
const EMAIL_DOMAINS = ["mailbox.in", "postmail.co.in", "inboxmail.com", "mybharat.net"];
const PSP = ["okaxis", "okbizaxis", "ibl", "apl", "yescred", "tapicici"];
const STATE_CODES = ["MH", "GJ", "KA", "AS", "MP", "OD", "UK", "AP"];

const digits = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");
const nonZeroDigits = (rng: Rng, n: number): string =>
  `${1 + Math.floor(rng() * 9)}${digits(rng, n - 1)}`;
const letters = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => pick(rng, "ABCDEFGHJKLMNPQRSTUVWXYZ".split(""))).join("");
const token = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => pick(rng, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""))).join("");

function profile(rng: Rng): Profile {
  const first = pick(rng, FIRST);
  const last = pick(rng, LAST);
  const [city, state, street] = pick(rng, LOCATIONS);
  const house = `${1 + Math.floor(rng() * 498)}${pick(rng, ["", "", "A", "B"])}`;
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const year = 1958 + Math.floor(rng() * 48);
  const username = `${first.slice(0, 1).toLowerCase()}${last.toLowerCase()}${digits(rng, 3)}`;
  return {
    name: `${first} ${last}`,
    devName: pick(rng, DEV_NAMES),
    email: `${first.toLowerCase()}_${last.toLowerCase()}${digits(rng, 2)}@${pick(rng, EMAIL_DOMAINS)}`,
    mobile: fakeMobile(rng),
    aadhaar: fakeAadhaar(rng),
    vid: fakeVid(rng),
    pan: fakePan(rng),
    dob: `${day}-${month}-${year}`,
    house,
    street,
    city,
    state,
    address: `${house}, ${street}, ${city}, ${state}`,
    pincode: fakePincode(rng),
    account: nonZeroDigits(rng, 14),
    ifsc: fakeIfsc(rng),
    upi: `${first.toLowerCase()}.${last.toLowerCase()}${digits(rng, 2)}@${pick(rng, PSP)}`,
    card: fakeCard(rng, pick(rng, ["4", "5", "6"])),
    gstin: fakeGstin(rng),
    passport: `${pick(rng, STATE_CODES).slice(0, 1)}${nonZeroDigits(rng, 7)}`,
    voterId: `${letters(rng, 3)}${nonZeroDigits(rng, 7)}`,
    drivingLicence: `${pick(rng, STATE_CODES)}${String(1 + Math.floor(rng() * 40)).padStart(2, "0")}${2010 + Math.floor(rng() * 15)}${nonZeroDigits(rng, 7)}`,
    username,
    password: `${pick(rng, ["Monsoon", "Peacock", "Marigold", "Saffron"])}!${digits(rng, 4)}${first.slice(0, 2)}`,
    ip: `10.${10 + Math.floor(rng() * 200)}.${1 + Math.floor(rng() * 253)}.${1 + Math.floor(rng() * 253)}`,
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
const devDigits = (value: string): string =>
  value.replace(/\d/g, (digit) => String.fromCharCode(0x0966 + Number(digit)));
const money = (value: number): string =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function inputField(label: string, value: string, cls: PiiClass, type = "text"): string {
  return `<div class="field"><label>${label}</label><input type="${type}" value="${escapeHtml(value)}" data-gt="${cls}" readonly></div>`;
}

function kycCard(label: string, value: string, extraClass = ""): string {
  return `<article class="kyc-card ${extraClass}"><small>${label}</small><div class="kyc-value">${value}</div><em>verified</em></article>`;
}

const FACE_URI = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="140" viewBox="0 0 120 140"><rect width="120" height="140" rx="10" fill="#dce6ef"/><circle cx="60" cy="48" r="27" fill="#b9825d"/><path d="M24 132c2-35 18-53 36-53s34 18 36 53" fill="#315a77"/><path d="M35 44c2-25 48-31 52 1-10-9-38-13-52-1" fill="#2f2725"/><circle cx="50" cy="50" r="2" fill="#222"/><circle cx="70" cy="50" r="2" fill="#222"/><path d="M51 64c6 5 13 5 19 0" fill="none" stroke="#7d3f33" stroke-width="2"/></svg>`,
)}`;

const CSS = `
*{box-sizing:border-box} body{margin:0;font:15px/1.5 "Segoe UI",Arial,"Nirmala UI",sans-serif;color:#1d2433;background:#f4f6fa}
header{background:#0b3d91;color:#fff;padding:14px 32px;display:flex;justify-content:space-between;align-items:center}
header b{font-size:20px} nav a{color:#dbe6ff;margin-left:18px;text-decoration:none}
main{max-width:1180px;margin:18px auto;background:#fff;border:1px solid #d9dee8;border-radius:8px;padding:22px 28px}
h1{font-size:22px;margin:0 0 12px} h2{font-size:17px;margin:18px 0 8px;color:#0b3d91}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 22px}
.field label{display:block;font-size:13px;color:#4a5568;margin-bottom:2px}
.field input,.field select,.field textarea{width:100%;padding:7px 9px;border:1px solid #b8c2d4;border-radius:5px;font:inherit}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #d9dee8;padding:6px 8px;text-align:left;font-size:14px}
th{background:#eef2f9} .meta{color:#6b7280;font-size:13px;columns:2;margin:14px 0 0}
button{background:#0b3d91;color:#fff;border:0;border-radius:5px;padding:9px 18px;font:inherit;margin-right:8px}
button.alt{background:#e8edf6;color:#0b3d91} .kv{display:grid;grid-template-columns:220px 1fr;gap:6px 14px}
.kv div:nth-child(odd){color:#4a5568} p{margin:6px 0}
`;

function page(title: string, body: string, extraHead = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style>${extraHead}</head>
<body><header><b>${title}</b><nav><a href="#">Home</a><a href="#">Services</a><a href="#">Track status</a><a href="#">Help</a></nav></header><main>${body}</main></body></html>`;
}

const HELDOUT_CSS = `<style>
.muted{color:#667085}.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#e8f3ec;color:#176b3a;font-size:12px}
.ticket-banner{display:flex;justify-content:space-between;align-items:center;background:#fff7e1;border-left:5px solid #e09114;padding:10px 14px;margin-bottom:12px}.ticket-banner strong{font-size:18px}.journey{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px;margin:10px 0 14px}.station{padding:10px;border:1px solid #d9dee8;border-radius:7px}.station:last-child{text-align:right}.route-line{color:#7a8494}.contact-strip{display:flex;gap:30px;background:#f6f8fb;padding:9px 12px;margin-top:10px;border-radius:6px}
.patient-top{display:grid;grid-template-columns:120px 1fr 150px;gap:20px;align-items:start}.patient-top img.portrait{width:104px;height:122px;object-fit:cover;border-radius:8px}.patient-top img.qr{width:112px;height:112px}.health-kv{display:grid;grid-template-columns:145px 1fr 120px 1fr;gap:7px 13px}.health-kv dt{color:#657083}.health-kv dd{margin:0;font-weight:600}.clinical-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.clinical-row div{border:1px solid #dce2ea;border-radius:7px;padding:9px}.clinical-row b{display:block;font-size:18px}
.statement-head{display:grid;grid-template-columns:1.4fr 1fr;gap:22px;padding-bottom:10px;border-bottom:2px solid #234f77}.statement-head address{font-style:normal}.statement-table td:nth-child(4),.statement-table td:nth-child(5),.statement-table td:nth-child(6){text-align:right;white-space:nowrap}.statement-table td:nth-child(3){font-family:Consolas,monospace;font-size:12px}.statement-foot{display:flex;justify-content:space-between;margin-top:10px}
.mail-toolbar{display:flex;align-items:center;justify-content:space-between}.mail-shell{display:grid;grid-template-columns:150px 310px 1fr;height:545px;border:1px solid #d8dee8;border-radius:8px;overflow:hidden}.mail-nav{background:#f3f6fa;padding:16px}.mail-nav div{padding:7px 4px}.mail-list{border-left:1px solid #d8dee8;border-right:1px solid #d8dee8;background:#fbfcfe}.mail-item{padding:10px 12px;border-bottom:1px solid #e5e9ef}.mail-item.selected{background:#e9f1ff}.mail-item strong,.mail-item small{display:block}.mail-item p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#667085}.mail-view{padding:17px 20px}.mail-from{padding-bottom:10px;border-bottom:1px solid #e1e6ee}.mail-body{font-size:15px;line-height:1.65}
.stepbar{display:flex;gap:8px;margin-bottom:14px}.stepbar span{flex:1;background:#edf1f7;padding:7px 10px;border-radius:5px;color:#586477}.stepbar span.active{background:#245d94;color:white}.hi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:11px 18px}.application-stamp{float:right;border:2px solid #2f6c4f;color:#2f6c4f;padding:5px 11px;transform:rotate(-2deg);font-weight:700}.form-actions{margin-top:14px;padding-top:12px;border-top:1px solid #dce2ea}
.order-head{display:flex;justify-content:space-between;align-items:start;border-bottom:1px solid #dce2ea;padding-bottom:11px}.order-layout{display:grid;grid-template-columns:1.45fr .75fr;gap:24px;margin-top:12px}.address-block{border:1px solid #cfd7e3;border-radius:8px;padding:13px 15px;background:#fafbfd;line-height:1.6}.address-block>strong{display:block;font-size:16px}.order-summary{background:#f7f9fc;border-radius:8px;padding:13px}.order-summary div{display:flex;justify-content:space-between;padding:5px 0}.order-summary .total{font-size:18px;border-top:1px solid #ccd5e2;margin-top:5px;padding-top:9px}
.kyc-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px}.kyc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.kyc-card{position:relative;min-height:76px;border:1px solid #d6dde7;border-radius:7px;padding:9px 10px;background:#fbfcfe;overflow:hidden}.kyc-card.wide{grid-column:span 2}.kyc-card small{display:block;text-transform:uppercase;letter-spacing:.09em;color:#697586;font-size:10px;font-weight:700}.kyc-value{font-weight:650;margin-top:5px;word-break:break-word}.kyc-card em{position:absolute;right:8px;bottom:5px;color:#31805a;font-size:9px;text-transform:uppercase}.kyc-card img{height:50px;width:auto;display:block;margin-top:3px}
.settings-layout{display:grid;grid-template-columns:2fr 1fr;gap:20px}.settings-panel{border:1px solid #d7dee8;border-radius:8px;padding:14px;margin-bottom:12px}.settings-panel h2{margin:0 0 9px}.secret-row{display:flex;justify-content:space-between;align-items:center;background:#101923;color:#cbe7ff;padding:10px 12px;border-radius:6px}.secret-row code{font-size:13px}.ip-chip{display:inline-block;background:#eef2f7;border:1px solid #d6dde7;padding:4px 8px;border-radius:4px;margin:3px 4px 3px 0;font-family:Consolas,monospace}.audit-terminal{background:#101923;border-radius:7px;padding:8px;width:666px}.audit-terminal canvas{display:block;width:650px;height:128px}.opaque-frame{width:100%;height:86px;border:1px solid #cfd7e3;border-radius:6px}
</style>`;

interface TemplateResult {
  title: string;
  html: string;
  tags: string[];
}
type Template = (rng: Rng, p: Profile, qr: string) => TemplateResult;

const templates: Record<string, Template> = {
  railway_reservation: (rng, p) => {
    const passengers = [p, profile(rng), profile(rng), profile(rng)];
    const pnr = nonZeroDigits(rng, 10);
    const bookingRef = `RB${digits(rng, 8)}`;
    const train = pick(rng, [
      ["12952", "Mumbai Rajdhani", "New Delhi", "Mumbai Central"],
      ["12628", "Karnataka Express", "New Delhi", "KSR Bengaluru"],
      ["12840", "Chennai Mail", "Howrah", "MGR Chennai"],
      ["12424", "Dibrugarh Rajdhani", "New Delhi", "Dibrugarh"],
    ]);
    const berths = ["B2 / 21 / LB", "B2 / 22 / MB", "B2 / 24 / UB", "B2 / 25 / SL"];
    return {
      title: "RailConnect Passenger Reservation",
      html: `<!-- PNR, train number, coach/berth and booking reference are travel decoys, not GT. -->
<div class="ticket-banner"><div><span class="muted">PNR</span><br><strong>${pnr}</strong></div><div>Booking ref. ${bookingRef}<br><span class="badge">CONFIRMED</span></div></div>
<h1>${train[0]} · ${train[1]}</h1>
<div class="journey"><div class="station"><b>${train[2]}</b><br>06:40 · 12 Oct 2026</div><div class="route-line">──── 1,284 km ────▶</div><div class="station"><b>${train[3]}</b><br>08:15 · 13 Oct 2026</div></div>
<table class="rail-table"><tr><th>#</th><th>Passenger</th><th>Age</th><th>Preference</th><th>Coach / Seat</th><th>Current status</th></tr>
${passengers
  .map(
    (passenger, index) =>
      `<tr><td>${index + 1}</td><td>${gt("PERSON", passenger.name)}</td><td>${18 + Math.floor(rng() * 57)}</td><td>${pick(rng, ["Lower", "Middle", "Upper", "Side lower"])}</td><td>${berths[index]}</td><td>CNF</td></tr>`,
  )
  .join("")}</table>
<div class="contact-strip"><div><span class="muted">Mob.</span> ${gt("PHONE", `+91 ${p.mobile}`)}</div><div><span class="muted">E-mail ID</span> ${gt("EMAIL", p.email)}</div><div><span class="muted">Quota</span> GENERAL</div></div>
<p class="muted">Fare ₹4,860.00 · Transaction ID ${nonZeroDigits(rng, 12)} · Chart status: prepared</p>
<p><button>Download ERS</button><button class="alt">Change boarding point</button></p>`,
      tags: ["table", "travel", "pnr-decoy"],
    };
  },

  abha_health_record: (rng, p, qr) => {
    const emergency = profile(rng);
    const abhaRaw = digits(rng, 14);
    const abha = `${abhaRaw.slice(0, 2)}-${abhaRaw.slice(2, 6)}-${abhaRaw.slice(6, 10)}-${abhaRaw.slice(10)}`;
    return {
      title: "SwasthyaSetu Longitudinal Record",
      html: `<!-- Known gap: the 14-digit ABHA number is deliberately unlabelled because ABHA has no benchmark class. -->
<div class="patient-top">
<img class="portrait" data-gt="FACE" src="${FACE_URI}" alt="">
<div><h1>${gt("PERSON", p.name)}</h1><div class="badge">Active patient</div>
<dl class="health-kv">
<dt>ABHA Number</dt><dd>${abha}</dd><dt>Date of birth</dt><dd>${gt("DOB", p.dob)}</dd>
<dt>Contact No.</dt><dd>${gt("PHONE", `+91 ${p.mobile}`)}</dd><dt>E-mail ID</dt><dd>${gt("EMAIL", p.email)}</dd>
<dt>पता</dt><dd>${gt("ADDRESS", p.address)}<br>PIN ${gt("PINCODE", p.pincode)}</dd><dt>Blood group</dt><dd>${pick(rng, ["A+", "B+", "O+", "AB-"])}</dd>
</dl></div>
<div><img class="qr" data-gt="QR" src="${qr}" alt=""><div class="muted">Scan record pass</div></div>
</div>
<div class="clinical-row"><div><span class="muted">BP</span><b>118 / 76</b>mmHg</div><div><span class="muted">HbA1c</span><b>5.7%</b>Lab ref. 650042</div><div><span class="muted">Last visit</span><b>24 Sep</b>OPD token 8841</div><div><span class="muted">Allergies</span><b>None</b>Reviewed</div></div>
<h2>Emergency contact</h2><p>${gt("PERSON", emergency.name)} · ${gt("PHONE", `+91 ${emergency.mobile}`)} · Relation: Family</p>
<p class="muted">Record reference HR-${digits(rng, 8)} · Claim amount ₹18,640 · Facility code 560078</p>
<p><button>Open consultation</button><button class="alt">Download summary</button></p>`,
      tags: ["health", "card", "face", "qr", "known-gap-abha"],
    };
  },

  upi_bank_statement: (rng, p) => {
    const payees = Array.from({ length: 5 }, () => profile(rng));
    let balance = 84250 + Math.floor(rng() * 40000);
    const rows = payees.map((payee, index) => {
      const debit = 240 + Math.floor(rng() * 8500);
      balance -= debit;
      const reference = nonZeroDigits(rng, 12);
      return `<tr><td>${String(index + 3).padStart(2, "0")}/08/2026</td><td>UPI/DR/${reference}/${gt("PERSON", payee.name.toUpperCase())}/okaxis/${gt("UPI", payee.upi)}</td><td>${reference}</td><td>₹${money(debit)}</td><td>—</td><td>₹${money(balance)}</td></tr>`;
    });
    return {
      title: "Janata Bank e-Statement",
      html: `<div class="statement-head"><div><h1>Statement of Account</h1><address><b>Customer:</b> ${gt("PERSON", p.name)}<br>${gt("ADDRESS", p.address)} · ${gt("PINCODE", p.pincode)}<br>E-mail ID: ${gt("EMAIL", p.email)}</address></div>
<div><b>Account</b> ${gt("BANK_ACCOUNT", p.account)}<br><b>IFSC</b> ${gt("IFSC", p.ifsc)}<br><b>Permanent Account Number</b> ${gt("PAN", p.pan)}<br><b>Period</b> 01 Aug 2026 – 31 Aug 2026</div></div>
<h2>Transaction activity</h2>
<table class="statement-table"><tr><th>Value date</th><th>Narration / Payee</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr>${rows.join("")}</table>
<div class="statement-foot"><span>Opening balance ₹${money(balance + 31940)}</span><b>Closing balance ₹${money(balance)}</b><span>Entries: 05</span></div>
<p class="muted">Branch code 004218 · MICR 395002041 · Page 1 of 1 · Figures are in INR.</p>
<p><button>Export CSV</button><button class="alt">Dispute a transaction</button></p>`,
      tags: ["table", "finance", "upi-narration"],
    };
  },

  webmail_inbox: (rng, p) => {
    const senders = [profile(rng), profile(rng), profile(rng)];
    const selected = senders[0]!;
    const otp = nonZeroDigits(rng, 6);
    const subjects = ["Action needed: approve sign-in", "Your service request is queued", "Minutes from the project call"];
    return {
      title: "DakMail Web Inbox",
      html: `<div class="mail-toolbar"><h1>Inbox</h1><div class="muted">Signed in as ${gt("EMAIL", p.email)}</div></div>
<div class="mail-shell">
<aside class="mail-nav"><button>Compose</button><div><b>Inbox 18</b></div><div>Starred</div><div>Sent</div><div>Drafts 2</div><div>Archive</div><hr><div class="muted">Storage 4.2 GB</div></aside>
<section class="mail-list">${senders
  .map(
    (sender, index) =>
      `<article class="mail-item ${index === 0 ? "selected" : ""}"><strong>${gt("PERSON", sender.name)}</strong><small>${gt("EMAIL", sender.email)}</small><p>${subjects[index]} · Ref ${digits(rng, 6)}</p></article>`,
  )
  .join("")}
<article class="mail-item"><strong>Parcel Desk</strong><small>Automated notification</small><p>Shipment AWB ${nonZeroDigits(rng, 11)} delivered</p></article>
</section>
<article class="mail-view"><h2>${subjects[0]}</h2><div class="mail-from"><b>From:</b> ${gt("PERSON", selected.name)} &lt;${gt("EMAIL", selected.email)}&gt;<br><b>To:</b> ${gt("PERSON", p.name)} &lt;${gt("EMAIL", p.email)}&gt; <span class="muted">· 10:42 AM</span></div>
<div class="mail-body"><p>Hello ${gt("PERSON", p.name)},</p><p>We could not complete the secure sign-in. Confirm the request using one-time code <b>${gt("OTP", otp)}</b>. The code expires in 10 minutes.</p>
<p>If this was not you, call the response desk on ${gt("PHONE", `+91 ${selected.mobile}`)} and quote incident SEC-${digits(rng, 7)}.</p>
<p>Regards,<br>${gt("PERSON", selected.name)}<br>Account Operations</p></div>
<button>Reply</button><button class="alt">Report phishing</button></article>
</div>`,
      tags: ["mail", "split-pane", "otp"],
    };
  },

  hindi_scheme_application: (rng, p) => {
    const guardian = pick(rng, DEV_NAMES);
    const hindiAddress = `मकान ${p.house}, ${pick(rng, ["शांति विहार", "आदर्श नगर", "नई बस्ती", "कृष्णा कॉलोनी"])}, ${p.city}, ${p.state}`;
    return {
      title: "जन-कल्याण आवास सहायता",
      html: `<span class="application-stamp">ई-सत्यापित</span><h1>लाभार्थी आवेदन · चरण २</h1>
<div class="stepbar"><span>१ · योजना</span><span class="active">२ · आवेदक विवरण</span><span>३ · बैंक</span><span>४ · घोषणा</span></div>
<p class="muted">आवेदन क्रमांक JKA-${digits(rng, 8)} · योजना कोड GRIH-650021 · वित्त वर्ष 2026–27</p>
<form class="hi-grid">
${inputField("आवेदक का नाम", p.devName, "PERSON")}
${inputField("नाम (English)", p.name, "PERSON")}
${inputField("अभिभावक / पति-पत्नी का नाम", guardian, "PERSON")}
${inputField("जन्म तिथि", p.dob, "DOB")}
${inputField("आधार संख्या", devDigits(spaced(p.aadhaar)), "AADHAAR")}
${inputField("मोबाइल नंबर", `+९१ ${devDigits(p.mobile)}`, "PHONE", "tel")}
${inputField("ई-मेल आईडी", p.email, "EMAIL", "email")}
${inputField("पता", hindiAddress, "ADDRESS")}
${inputField("पिन कोड", p.pincode, "PINCODE")}
${inputField("बैंक खाता संख्या", p.account, "BANK_ACCOUNT")}
${inputField("आईएफएससी कोड", p.ifsc, "IFSC")}
${inputField("स्थायी खाता संख्या (PAN)", p.pan, "PAN")}
</form>
<div class="form-actions"><button type="button">सहेजें और आगे बढ़ें</button><button type="button" class="alt">पिछला चरण</button><span class="muted"> दस्तावेज़ सेट 04 · राशन यूनिट 650049</span></div>`,
      tags: ["form", "devanagari", "mixed-script"],
    };
  },

  ecommerce_order: (rng, p) => {
    const orderId = `OD${digits(rng, 14)}`;
    const tracking = `XPR${nonZeroDigits(rng, 10)}IN`;
    const itemRows = [
      ["Cotton bedsheet set", "HOM-BED-650041", "6304", "2", "₹1,298.00"],
      ["Stainless steel flask", "KIT-FLK-560072", "9617", "1", "₹849.00"],
      ["LED study lamp", "LGT-LMP-110086", "9405", "1", "₹1,499.00"],
    ];
    return {
      title: "BazaarCart Order Details",
      html: `<div class="order-head"><div><h1>Order ${orderId}</h1><span class="badge">Out for delivery</span></div><div>Placed 28 Sep 2026<br><span class="muted">Shipment ${tracking}</span></div></div>
<div class="order-layout"><section>
<h2>Items in this shipment</h2><table><tr><th>Product</th><th>SKU</th><th>HSN</th><th>Qty</th><th>Line total</th></tr>
${itemRows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>
<p class="muted">Warehouse bin 400076 · Package weight 6.50 kg · Pick list 650039 · Tax invoice INV-${digits(rng, 7)}</p>
<h2>Delivery timeline</h2><p>✓ Ordered &nbsp; ✓ Packed &nbsp; ✓ Shipped &nbsp; ● Out for delivery</p>
<p><button>Track package</button><button class="alt">Download invoice</button></p></section>
<aside><h2>Deliver to</h2><div class="address-block"><strong>${gt("PERSON", p.name)}</strong>
<div data-gt="ADDRESS">${escapeHtml(`${p.house}, ${p.street}`)}<br>${escapeHtml(`${p.city}, ${p.state}`)}</div>
${gt("PINCODE", p.pincode)}<br>Contact No. ${gt("PHONE", `+91 ${p.mobile}`)}<br>E-mail ID ${gt("EMAIL", p.email)}</div>
<p>GST invoice for ${gt("GSTIN", p.gstin)}</p>
<div class="order-summary"><div><span>Item total</span><span>₹3,646.00</span></div><div><span>Delivery</span><span>₹80.00</span></div><div><span>Coupon CART250</span><span>−₹250.00</span></div><div class="total"><b>Paid</b><b>₹3,476.00</b></div></div></aside></div>`,
      tags: ["commerce", "address-block", "sku-decoys"],
    };
  },

  kyc_admin_grid: (rng, p, qr) => ({
    title: "TrustDesk KYC Review",
    html: `<div class="kyc-toolbar"><div><h1>Customer verification workspace</h1><span class="muted">Case KYC-${digits(rng, 9)} · Queue 650044</span></div><div><span class="badge">18 checks passed</span> <button>Approve</button></div></div>
<section class="kyc-grid">
${kycCard("Customer", gt("PERSON", p.name))}
${kycCard("Date of birth", gt("DOB", p.dob))}
${kycCard("Mob.", gt("PHONE", `+91 ${p.mobile}`))}
${kycCard("E-mail ID", gt("EMAIL", p.email))}
${kycCard("Aadhaar number", gt("AADHAAR", spaced(p.aadhaar)))}
${kycCard("Virtual identity", gt("AADHAAR_VID", spaced(p.vid)))}
${kycCard("Permanent account number", gt("PAN", p.pan))}
${kycCard("Goods & services tax ID", gt("GSTIN", p.gstin))}
${kycCard("Settlement account", gt("BANK_ACCOUNT", p.account))}
${kycCard("Branch routing / IFSC", gt("IFSC", p.ifsc))}
${kycCard("Passport", gt("PASSPORT", p.passport))}
${kycCard("Elector photo ID", gt("VOTER_ID", p.voterId))}
${kycCard("Driving entitlement", gt("DRIVING_LICENCE", p.drivingLicence))}
${kycCard("Residential address", gt("ADDRESS", p.address), "wide")}
${kycCard("Postal PIN", gt("PINCODE", p.pincode))}
${kycCard("Portal username", gt("USERNAME", p.username))}
${kycCard("Portrait match", `<img data-gt="FACE" src="${FACE_URI}" alt="">`)}
${kycCard("Document barcode", `<img data-gt="QR" src="${qr}" alt="">`)}
</section>
<p class="muted">Screening batch 20260930 · Risk score 12/100 · Rule pack v7.4.2 · Reviewed 30 Sep 2026</p>`,
    tags: ["css-grid", "kyc", "face", "qr"],
  }),

  developer_settings: (rng, p) => {
    const apiKey = `pk_live_${token(rng, 32)}`;
    const signingSecret = `whsec_${token(rng, 28)}`;
    const auditIp = `172.20.${1 + Math.floor(rng() * 200)}.${1 + Math.floor(rng() * 253)}`;
    const secondIp = `192.168.${1 + Math.floor(rng() * 200)}.${1 + Math.floor(rng() * 253)}`;
    return {
      title: "OrbitPay Developer Settings",
      html: `<h1>Workspace settings</h1><div class="settings-layout"><section>
<div class="settings-panel"><h2>Developer identity</h2><div class="grid">
${inputField("Username", p.username, "USERNAME")}
${inputField("Recovery e-mail", p.email, "EMAIL", "email")}
${inputField("Console password", p.password, "PASSWORD", "password")}
</div></div>
<div class="settings-panel"><h2>Live API key</h2><div class="secret-row"><code data-gt="SECRET">${escapeHtml(apiKey)}</code><button>Rotate key</button></div><p class="muted">Created 03 Sep 2026 · Request quota 650000 per month</p></div>
<div class="settings-panel"><h2>Recent authenticated event</h2><div class="audit-terminal"><canvas id="auditCanvas" width="650" height="128"></canvas></div></div>
</section><aside>
<div class="settings-panel"><h2>Allowed IP addresses</h2><span class="ip-chip" data-gt="IP_ADDRESS">${escapeHtml(p.ip)}</span><span class="ip-chip" data-gt="IP_ADDRESS">${escapeHtml(secondIp)}</span><p class="muted">CIDR rule set NET-240091</p></div>
<div class="settings-panel"><h2>Billing method</h2><!-- Masked card is intentionally not GT. --><p>XXXX XXXX XXXX ${p.card.slice(-4)}</p><p class="muted">Already masked · default billing route</p></div>
<div class="settings-panel"><h2>Compliance widget</h2><iframe class="opaque-frame" data-gt="OPAQUE" sandbox title="Third-party compliance widget" srcdoc="<div style='font:13px Arial;padding:12px;color:#334'>Vendor security console<br>Status: connected<br>Audit ref. 650037</div>"></iframe></div>
</aside></div>
<script>
window.__gt = [];
const canvas = document.getElementById('auditCanvas');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, 650, 128);
ctx.font = '14px Consolas, monospace';
ctx.fillStyle = '#78dba9'; ctx.fillText('AUTH EVENT / SUCCESS', 16, 24);
const bounds = canvas.getBoundingClientRect();
function auditLine(prefix, value, cls, y) {
  ctx.fillStyle = '#8ea3b8'; ctx.fillText(prefix, 16, y);
  const start = 16 + ctx.measureText(prefix).width;
  ctx.fillStyle = '#f4f7fb'; ctx.fillText(value, start, y);
  const sx = bounds.width / canvas.width, sy = bounds.height / canvas.height;
  window.__gt.push({ cls, rect: { x: bounds.left + start * sx, y: bounds.top + (y - 14) * sy, w: ctx.measureText(value).width * sx, h: 18 * sy } });
}
auditLine('actor: ', ${JSON.stringify(p.username)}, 'USERNAME', 50);
auditLine('source_ip: ', ${JSON.stringify(auditIp)}, 'IP_ADDRESS', 76);
auditLine('signing_secret: ', ${JSON.stringify(signingSecret)}, 'SECRET', 102);
</script>`,
      tags: ["settings", "canvas", "opaque", "masked-card"],
    };
  },
};

async function main(): Promise<void> {
  const wasm = readFileSync(join(here, "..", "..", "node_modules", "zxing-wasm", "dist", "writer", "zxing_writer.wasm"));
  await prepareZXingModule({
    overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer },
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
    writeFileSync(join(OUT, file), page(result.title, result.html, HELDOUT_CSS));
    manifest.push({ file, template: templateName, tags: result.tags });
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ seed: SEED, pages: manifest }, null, 2));
  console.log(`wrote ${N} pages to ${OUT}`);
}

await main();
