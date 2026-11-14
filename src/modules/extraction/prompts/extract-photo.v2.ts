import { sectorRulesV1 } from "./sector-rules.v1";

// Version 2 (14 Nov 2026): one change from v1 — the City rule (city name only). Text: plan.md §9.3.
// Do not change the wording: make a new version file and re-run the eval.
const text = `You read a photo of business cards for a university office in Iraq. The photo may contain one card or many (up to about 15), laid out on a table, possibly rotated, angled, overlapping slightly, or under uneven light. Cards may be Arabic, English, or bilingual (Arabic on one half, English on the other).

First count every business card visible in the photo, including partly visible ones. Report that number as cardCount.
Then extract one contact per card, in reading order: top-left to bottom-right, row by row. contacts must contain exactly cardCount entries — one per card, even if a card is hard to read (fill what you can read and leave the rest "").

Each contact has exactly these 8 fields:
- FullName: the person's name exactly as printed. If the card shows the name in Arabic and English, write "Arabic / English" (e.g. "أحمد علي / Ahmed Ali").
- Position: job title as printed; bilingual as "Arabic / English".
- Mobile: mobile number(s) as printed (Iraqi mobiles start with 07 or +9647). Several: separate with ", ".
- Company: the organization as printed; bilingual as "Arabic / English". If the only organization name is in the logo, use the logo text.
- City: the city name only, taken from a location printed on the card (address line). Write the city alone, without country, district or street: "Baghdad, Iraq" → "Baghdad"; "الجادرية - بغداد" → "بغداد". A printed district or street goes to Notes as "Address: …". Never take the city from a company or organization name ("Basra Oil Company" does not mean City is Basra).
- Email: email address(es) as printed. Several: separate with ", ".
- {SECTOR_RULES}
- Notes: everything else useful on the card, each item labelled and separated by "; ": office/landline numbers, fax, extension, website, street address, P.O. box, social handles (e.g. "Office: +964 1 717 0000; Website: example.com").

Rules:
- Never invent or guess. Copy text exactly as printed; do not translate, transliterate, or correct spelling. Anything you cannot read is "" (except Sector, which is never empty).
- Read digits carefully; Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) are fine to copy as printed.
- Numbers labelled office, tel, landline, هاتف, فاكس, fax go to Notes. Numbers labelled mobile, mob, M, موبايل, جوال, or unlabelled mobile-looking numbers go to Mobile.
- Each card is a separate contact even if two cards belong to the same company. Never merge two cards.
- If the photo contains no business cards, return cardCount 0 and an empty list.`;

export const extractPhotoV2 = {
  id: "extract-photo.v2",
  text: text.replace("{SECTOR_RULES}", sectorRulesV1.text),
};
