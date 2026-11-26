import type { Scope } from "@/modules/accounts/scope";
import { splitMulti, type ContactInput } from "./contact.schema";
import { getContact } from "./contacts.repo";

// vCard 3.0 for "Add to phone contacts".

function escapeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a line at 75 bytes, never inside a character. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function toVcard(contact: ContactInput): string {
  const mobiles = splitMulti(contact.Mobile);
  const emails = splitMulti(contact.Email);
  const displayName = contact.FullName || contact.Company || mobiles[0] || emails[0] || "Contact";

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeValue(displayName)}`,
    // The name is never split into family / given: it may be Arabic or bilingual.
    `N:;${escapeValue(contact.FullName)};;;`,
    ...mobiles.map((mobile) => `TEL;TYPE=CELL:${escapeValue(mobile)}`),
    ...emails.map((email) => `EMAIL;TYPE=INTERNET:${escapeValue(email)}`),
  ];
  if (contact.Company) lines.push(`ORG:${escapeValue(contact.Company)}`);
  if (contact.Position) lines.push(`TITLE:${escapeValue(contact.Position)}`);
  if (contact.City) lines.push(`ADR;TYPE=WORK:;;;${escapeValue(contact.City)};;;`);
  if (contact.Notes) lines.push(`NOTE:${escapeValue(contact.Notes)}`);
  lines.push("END:VCARD");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Latin letters and digits of the name joined by "-", or contact.vcf. */
export function vcardFilename(contact: ContactInput): string {
  const words = (contact.FullName || contact.Company).match(/[A-Za-z0-9]+/g);
  return words && words.length > 0 ? `${words.join("-")}.vcf` : "contact.vcf";
}

export async function contactVcard(
  scope: Scope,
  id: string,
): Promise<{ body: string; filename: string }> {
  const contact = await getContact(scope, id);
  return { body: toVcard(contact), filename: vcardFilename(contact) };
}
