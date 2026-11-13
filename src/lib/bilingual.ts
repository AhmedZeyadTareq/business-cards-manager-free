// Display helpers for values stored as "English / العربية" (either order is stored).

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

export function isArabic(value: string): boolean {
  return ARABIC.test(value);
}

/**
 * Splits a bilingual value into one line per language, English first. A value with a
 * slash that is not bilingual ("Sales / Marketing") stays on one line.
 */
export function splitBilingual(value: string): string[] {
  const parts = value.split(" / ").map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return [value];
  const [first, second] = parts;
  if (isArabic(first) === isArabic(second)) return [value];
  return isArabic(first) ? [second, first] : [first, second];
}

/** Avatar initials: two letters from the English line when there is one. */
export function initials(fullName: string, company = ""): string {
  const source = splitBilingual(fullName || company)[0].trim();
  if (!source) return "?";
  const words = source.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return "?";
  const first = [...words[0]][0];
  // Arabic letters join when side by side: one letter reads better.
  if (isArabic(first) || words.length === 1) return first.toUpperCase();
  return (first + [...words[words.length - 1]][0]).toUpperCase();
}
