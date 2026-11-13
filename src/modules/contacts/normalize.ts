import {
  type ContactInput,
  MULTI_SEPARATOR,
  matchSector,
  normalizeSector,
  splitMulti,
} from "./contact.schema";

// Cleaning rules (plan.md §5.2). They never add data.

export { matchSector, normalizeSector };

const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, "");
}

/** Removes invisible direction marks, collapses whitespace, trims. Letters stay as written. */
export function normalizeText(value: string): string {
  return stripInvisible(value).replace(/\s+/g, " ").trim();
}

/** Arabic-Indic and Persian digits → 0-9. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * For comparing and searching only, never stored. Must fold the same letters as the
 * search index mapping (docs/tools.md §9).
 */
export function foldArabic(value: string): string {
  return normalizeDigits(normalizeText(value))
    .replace(/[ً-ٰٟـ]/g, "") // harakat and tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ی/g, "ي") // Persian / Kurdish yeh
    .replace(/ک/g, "ك") // Persian / Kurdish kaf
    .toLowerCase();
}

// ---------- Mobile ----------

const IRAQI_MOBILE = /^(?:00964|9640|964|0)?(7\d{9})$/;

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** Only `+ digits space - ( ) .`, and 6–15 digits not counting a leading 00. */
function isPlausibleNumber(value: string): boolean {
  if (!/^[+\d\s\-().]+$/.test(value)) return false;
  const count = digitsOf(value).replace(/^00/, "").length;
  return count >= 6 && count <= 15;
}

/** Removes a printed trunk zero `(0)` and any label before the first digit or `+`. */
function stripLabel(piece: string): string {
  return piece
    .replace(/\(\s*0\s*\)/g, "")
    .replace(/^[^\d+]*/, "")
    .trim();
}

/** A piece with more than 15 digits may be several numbers written with spaces between. */
function splitLongPiece(piece: string): string[] {
  const parts = piece.split(/[\s-]+/).filter(Boolean);
  const numbers: string[] = [];
  let current: string[] = [];
  parts.forEach((part, index) => {
    current.push(part);
    const next = parts[index + 1];
    const complete = IRAQI_MOBILE.test(digitsOf(stripLabel(current.join(" "))));
    const nextStarts = next !== undefined && /^(\+|00)/.test(next);
    if (complete || nextStarts) {
      numbers.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) numbers.push(current.join(" "));
  const allPlausible = numbers.every((number) => isPlausibleNumber(stripLabel(number)));
  return numbers.length > 1 && allPlausible ? numbers : [piece];
}

function normalizeOneMobile(written: string): string | undefined {
  if (!/\d/.test(written)) return undefined;
  const value = stripLabel(written);
  if (!isPlausibleNumber(value)) return written;
  const digits = digitsOf(value);

  const iraqi = IRAQI_MOBILE.exec(digits);
  if (iraqi) return `+964${iraqi[1]}`;

  if (/^(\+|00)/.test(value)) {
    const international = digits.replace(/^00/, "").replace(/^9640/, "964");
    if (international.startsWith("9647")) return written;
    return `+${international}`;
  }
  if (/^964\d{9,10}$/.test(digits)) return `+${digits}`;
  if (/^(07|7|964)/.test(digits)) return written;
  return digits;
}

/** Mobile numbers, each normalized or kept as written, joined with ` | `. */
export function normalizeMobile(value: string): string {
  const text = normalizeDigits(stripInvisible(value));
  const pieces = text
    .split(/[,;؛|\n\r/،]|\s+or\s+|\s+و\s+|\s+أو\s+/i)
    .map((piece) => piece.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((piece) => (digitsOf(piece).length > 15 ? splitLongPiece(piece) : [piece]));

  const numbers: string[] = [];
  for (const piece of pieces) {
    const number = normalizeOneMobile(piece);
    if (number && !numbers.includes(number)) numbers.push(number);
  }
  return numbers.join(MULTI_SEPARATOR);
}

/** The numbers that could not be formatted: the UI shows "check this number". */
export function unusualMobiles(value: string): string[] {
  return splitMulti(value).filter((number) => !/^\+\d{7,15}$/.test(number));
}

// ---------- Email ----------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function emailTokens(value: string): string[] {
  const tokens = normalizeText(value)
    .toLowerCase()
    .replace(/mailto:/g, "")
    .split(/[\s,;؛،|/]+/)
    .map((token) => token.replace(/^[<("']+/, "").replace(/[>)"'.]+$/, ""))
    .filter(Boolean);
  return [...new Set(tokens)];
}

export function normalizeEmail(value: string): string {
  return emailTokens(value)
    .filter((token) => EMAIL.test(token))
    .join(MULTI_SEPARATOR);
}

export function invalidEmails(value: string): string[] {
  return emailTokens(value).filter((token) => !EMAIL.test(token));
}

// ---------- Whole contact ----------

function cleanFields(input: ContactInput, email: (value: string) => string): ContactInput {
  return {
    FullName: normalizeText(input.FullName),
    Position: normalizeText(input.Position),
    Mobile: normalizeMobile(input.Mobile),
    Company: normalizeText(input.Company),
    City: normalizeText(input.City),
    Email: email(input.Email),
    Sector: normalizeSector(input.Sector),
    Notes: stripInvisible(input.Notes).trim(),
  };
}

/** Runs on every insert and update. */
export function cleanContact(input: ContactInput): ContactInput {
  return cleanFields(input, normalizeEmail);
}

/** `cleanContact`, but keeps every email token so the review list can show invalid ones. */
export function cleanForReview(input: ContactInput): ContactInput {
  return cleanFields(input, (value) => emailTokens(value).join(MULTI_SEPARATOR));
}

/** Keys for duplicate checks and exact lookups. The input is already cleaned. */
export function toMatchKeys(contact: Pick<ContactInput, "Mobile" | "Email">): {
  _mobiles: string[];
  _emails: string[];
} {
  const mobiles = splitMulti(contact.Mobile)
    .map((mobile) => mobile.replace(/[^\d+]/g, ""))
    .filter((mobile) => digitsOf(mobile).length >= 6);
  return { _mobiles: [...new Set(mobiles)], _emails: [...new Set(splitMulti(contact.Email))] };
}

export function isEmptyContact(contact: ContactInput): boolean {
  return (
    !contact.FullName &&
    !contact.Position &&
    !contact.Mobile &&
    !contact.Company &&
    !contact.City &&
    !contact.Email &&
    !contact.Notes
  );
}
