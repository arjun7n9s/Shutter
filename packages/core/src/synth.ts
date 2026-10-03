import { gstinCheckChar, luhnCheckDigit, verhoeffCheckDigit } from "./checksums";

/** Deterministic PRNG so synthetic corpora and tests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const digits = (rng: Rng, n: number) => Array.from({ length: n }, () => Math.floor(rng() * 10)).join("");
const letters = (rng: Rng, n: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ") =>
  Array.from({ length: n }, () => alphabet[Math.floor(rng() * alphabet.length)]).join("");

export function fakeAadhaar(rng: Rng): string {
  const body = String(2 + Math.floor(rng() * 8)) + digits(rng, 10);
  return body + verhoeffCheckDigit(body);
}

export function fakeVid(rng: Rng): string {
  const body = digits(rng, 15);
  return body + verhoeffCheckDigit(body);
}

export function fakeCard(rng: Rng, prefix = "4"): string {
  const body = prefix + digits(rng, 15 - prefix.length);
  return body + luhnCheckDigit(body);
}

export function fakePan(rng: Rng, holder = "P"): string {
  return letters(rng, 3) + holder + letters(rng, 1) + digits(rng, 4) + letters(rng, 1);
}

export function fakeGstin(rng: Rng): string {
  const state = String(1 + Math.floor(rng() * 37)).padStart(2, "0");
  const first14 = state + fakePan(rng, "C") + String(1 + Math.floor(rng() * 9)) + "Z";
  return first14 + gstinCheckChar(first14);
}

export function fakeMobile(rng: Rng): string {
  return String(6 + Math.floor(rng() * 4)) + digits(rng, 9);
}

export function fakeIfsc(rng: Rng): string {
  return letters(rng, 4) + "0" + letters(rng, 6, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
}

export function fakePincode(rng: Rng): string {
  return String(1 + Math.floor(rng() * 8)) + digits(rng, 5);
}

export function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}
