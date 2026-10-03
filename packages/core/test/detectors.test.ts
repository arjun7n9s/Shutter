import { describe, expect, it } from "vitest";
import {
  aadhaarValid,
  detect,
  fakeAadhaar,
  fakeCard,
  fakeGstin,
  fakeMobile,
  fakePan,
  fakeVid,
  gstinValid,
  luhnValid,
  mulberry32,
  verhoeffValid,
} from "../src";

const rng = mulberry32(42);
const classes = (text: string) => detect(text).map((s) => [s.cls, text.slice(s.start, s.end)]);

describe("checksums", () => {
  it("generated identifiers validate", () => {
    for (let i = 0; i < 200; i++) {
      expect(aadhaarValid(fakeAadhaar(rng))).toBe(true);
      expect(luhnValid(fakeCard(rng))).toBe(true);
      expect(gstinValid(fakeGstin(rng))).toBe(true);
      expect(verhoeffValid(fakeVid(rng))).toBe(true);
    }
  });

  it("single-digit corruption breaks Verhoeff", () => {
    const a = fakeAadhaar(rng);
    const bad = a.slice(0, 5) + ((Number(a[5]) + 1) % 10) + a.slice(6);
    expect(aadhaarValid(bad)).toBe(false);
  });

  it("known Luhn vectors", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});

describe("detect", () => {
  it("finds Aadhaar in grouped and plain forms, rejects bad checksum", () => {
    const a = fakeAadhaar(rng);
    const grouped = `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`;
    expect(classes(`Aadhaar: ${grouped}`)).toEqual([["AADHAAR", grouped]]);
    expect(classes(`id ${a} ok`)).toEqual([["AADHAAR", a]]);
    const bad = a.slice(0, 11) + ((Number(a[11]) + 1) % 10);
    expect(classes(`id ${bad}`).find(([c]) => c === "AADHAAR")).toBeUndefined();
  });

  it("does not match Aadhaar with mixed separators", () => {
    const a = fakeAadhaar(rng);
    expect(classes(`${a.slice(0, 4)} ${a.slice(4, 8)}-${a.slice(8)}`).find(([c]) => c === "AADHAAR")).toBeUndefined();
  });

  it("reads Devanagari digits", () => {
    const m = fakeMobile(rng);
    const dev = m.replace(/\d/g, (d) => String.fromCharCode(0x0966 + Number(d)));
    expect(classes(`मोबाइल ${dev}`)).toEqual([["PHONE", dev]]);
  });

  it("phones with prefixes", () => {
    const m = fakeMobile(rng);
    for (const p of [`+91 ${m}`, `+91-${m}`, `0${m}`, `${m.slice(0, 5)} ${m.slice(5)}`]) {
      expect(classes(`call ${p} now`)).toEqual([["PHONE", p]]);
    }
  });

  it("GSTIN beats the PAN inside it", () => {
    const g = fakeGstin(rng);
    expect(classes(`GSTIN ${g}`)).toEqual([["GSTIN", g]]);
  });

  it("PAN, IFSC, email and UPI are distinct", () => {
    const pan = fakePan(rng);
    const text = `PAN ${pan}, IFSC SBIN0001234, mail a.b@example.co.in, pay ravi.k@okhdfcbank`;
    expect(classes(text)).toEqual([
      ["PAN", pan],
      ["IFSC", "SBIN0001234"],
      ["EMAIL", "a.b@example.co.in"],
      ["UPI", "ravi.k@okhdfcbank"],
    ]);
  });

  it("card vs VID depends on context", () => {
    const vid = fakeVid(rng);
    const spaced = vid.replace(/(\d{4})(?=\d)/g, "$1 ");
    expect(classes(`VID: ${spaced}`)[0]?.[0]).toBe("AADHAAR_VID");
    const card = fakeCard(rng);
    expect(classes(`card ${card}`)).toEqual([["CARD", card]]);
  });

  it("context-gated classes need their keyword", () => {
    expect(classes("Order total 560034 units")).toEqual([]);
    expect(classes("PIN code: 560034")).toEqual([["PINCODE", "560034"]]);
    expect(classes("Your OTP is 482913")).toEqual([["OTP", "482913"]]);
    expect(classes("Account No. 123456789012")).toEqual([["BANK_ACCOUNT", "123456789012"]]);
    expect(classes("Date of Birth: 14/08/1996")).toEqual([["DOB", "14/08/1996"]]);
    expect(classes("Meeting on 14/08/1996")).toEqual([]);
    expect(classes("Passport No: K1234567")).toEqual([["PASSPORT", "K1234567"]]);
  });

  it("names from honorifics, relations and labels, not from ordinary capitalised prose", () => {
    expect(classes("Applicant: Shri Ramesh Kumar Verma")).toEqual([["PERSON", "Ramesh Kumar Verma"]]);
    expect(classes("S/O Suresh Iyer")).toEqual([["PERSON", "Suresh Iyer"]]);
    expect(classes("Name: Priya Nair")).toEqual([["PERSON", "Priya Nair"]]);
    expect(classes("नाम: अनीता शर्मा")).toEqual([["PERSON", "अनीता शर्मा"]]);
    expect(classes("श्रीमती सुनीता देवी")).toEqual([["PERSON", "सुनीता देवी"]]);
    expect(classes("Bill to: Arjun Banerjee")).toEqual([["PERSON", "Arjun Banerjee"]]);
    expect(classes("Username: Admin")).toEqual([]);
    expect(classes("Name: submit the form")).toEqual([]);
    expect(classes("Welcome To The Portal")).toEqual([]);
  });

  it("secrets", () => {
    expect(classes("key AKIAABCDEFGHIJKLMNOP here")[0]?.[0]).toBe("SECRET");
    expect(classes("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")[0]?.[0]).toBe("SECRET");
  });

  it("output spans never overlap", () => {
    const text = `Name: Asha Rao, Aadhaar ${fakeAadhaar(rng)}, mobile +91 ${fakeMobile(rng)}, GSTIN ${fakeGstin(rng)}, card ${fakeCard(rng)}`;
    const spans = detect(text);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    expect(new Set(spans.map((s) => s.cls))).toEqual(new Set(["PERSON", "AADHAAR", "PHONE", "GSTIN", "CARD"]));
  });

  it("names from layout conventions", () => {
    expect(classes("From: Kabir Kapoor <kabir.k@example.in>")).toEqual([
      ["PERSON", "Kabir Kapoor"],
      ["EMAIL", "kabir.k@example.in"],
    ]);
    expect(classes("Hello Omkar Bose,")).toEqual([["PERSON", "Omkar Bose"]]);
    expect(classes("Hello Team,")).toEqual([]);
    expect(classes("Regards,\nKabir Kapoor\nAccount Operations")).toEqual([["PERSON", "Kabir Kapoor"]]);
    expect(classes("UPI/DR/721502301329/TENZIN BOSE/okaxis/")[0]).toEqual(["PERSON", "TENZIN BOSE"]);
    expect(classes("Customer: Tanvi Wagh")).toEqual([["PERSON", "Tanvi Wagh"]]);
    expect(classes("Tenzin Sheikh\ntenzin@mail.example.in\nYour request is queued")[0]).toEqual(["PERSON", "Tenzin Sheikh"]);
  });

  it("unlabelled names from the gazetteer, without firing on shop, place or UI words", () => {
    const person = (t: string) => detect(t).filter((s) => s.cls === "PERSON").map((s) => t.slice(s.start, s.end));
    expect(person("Paid to Noor Qureshi yesterday")).toEqual(["Noor Qureshi"]);
    expect(person("K. Ramachandran")).toEqual(["K. Ramachandran"]);
    expect(person("Faculty: R. S. Iyer")).toEqual(["R. S. Iyer"]);
    expect(person("TENZIN BOSE")).toEqual(["TENZIN BOSE"]);
    expect(person("Priya")).toEqual(["Priya"]);
    expect(person("Priya Wanchoo")).toEqual(["Priya Wanchoo"]);
    for (const t of ["Karnataka Express", "Thomas Cook Travels booked", "Rahul Traders", "More Details", "Park Street", "Priya said hello"]) {
      expect(person(t)).toEqual([]);
    }
  });

  it("unlabelled postal address blocks", () => {
    const one = "438B, Beltola Road, Guwahati, Assam · 227391";
    expect(classes(one).map((x) => x[0])).toContain("ADDRESS");
    const block = "Ayesha Qureshi\n10B, Dharampeth\nNagpur, Maharashtra\n859852\nContact No.";
    expect(classes(block).slice(0, 2)).toEqual([
      ["PERSON", "Ayesha Qureshi"],
      ["ADDRESS", "10B, Dharampeth\nNagpur, Maharashtra\n859852"],
    ]);
    expect(classes("12628 · Karnataka Express")).toEqual([]);
    expect(classes("New Delhi\n06:40 · 12 Oct 2026")).toEqual([]);
    expect(classes("Warehouse bin 400076 · Pick list 650039")).toEqual([]);
  });

  it("labelled address inside a one-line instruction, stopping before the next field", () => {
    const text =
      "Applicant Meera Iyer, address 18, Lake View Road, Kochi, Kerala 400734, IFSC OQRZ0W73BGM, account 384920175633.";
    expect(classes(text)).toEqual(
      expect.arrayContaining([
        ["ADDRESS", "18, Lake View Road, Kochi, Kerala 400734"],
        ["IFSC", "OQRZ0W73BGM"],
        ["BANK_ACCOUNT", "384920175633"],
      ]),
    );
  });

  it("vendor API keys", () => {
    expect(classes("pk_live_QLhbUvmAfYstm5Jon286dxHH1nbeVy8v")[0]?.[0]).toBe("SECRET");
    expect(classes("API key: 9f8e7d6c5b4a39281706f5e4d3c2b1a0")[0]?.[0]).toBe("SECRET");
  });

  it("a lower-scored container span is split around a winner, not dropped", () => {
    const text = "12 MG Road, Indiranagar, PIN 560038";
    const address = { start: 0, end: text.length, cls: "ADDRESS" as const, score: 0.75, rule: "label.ADDRESS" };
    const spans = detect(text, { extra: [address] }).map((s) => [s.cls, text.slice(s.start, s.end)]);
    expect(spans).toEqual([
      ["ADDRESS", "12 MG Road, Indiranagar, PIN"],
      ["PINCODE", "560038"],
    ]);
  });
});
