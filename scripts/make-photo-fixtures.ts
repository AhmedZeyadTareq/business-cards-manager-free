// npm run fixtures:photos
// Renders the 10 synthetic photo fixtures (plan.md §10) into tests/fixtures/photos/:
// <name>.jpg + <name>.expected.json (contacts in reading order). All people are invented.
// Deterministic: fixed seed, and text is drawn only with the font files in tests/fixtures/fonts/.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContactInput, Sector } from "@/modules/contacts/contact.schema";
import { cleanContact } from "@/modules/contacts/normalize";

const FONT_DIR = path.resolve("tests/fixtures/fonts");
const OUT_DIR = path.resolve("tests/fixtures/photos");
const FONT = "IBM Plex Sans Arabic";

// Card size in drawing units; every card is scaled from this.
const CARD_W = 1000;
const CARD_H = 580;

type Names = { name: string; title: string; company: string };

type Card = {
  ar?: Names;
  en?: Names;
  /** As printed. */
  mobiles: string[];
  tel?: string;
  fax?: string;
  email: string;
  website?: string;
  /** Printed once, in one language, on the address line. */
  city: string;
  /** Street or district, printed before the city. */
  address?: string;
  sector: Sector;
};

const BUSINESS: Sector = "Businesses & Financial Institutions";
const GOVERNMENT: Sector = "Ministries & Government";
const INTERNATIONAL: Sector = "Embassies & International Organizations";
const EDUCATION: Sector = "Universities & Education";
const NGO: Sector = "NGOs & Civil Society";
const PROFESSIONAL: Sector = "Professional & Other Contacts";

const ENGLISH: Card[] = [
  {
    en: { name: "Mohammed Al-Saadi", title: "Marketing Manager", company: "Asiacell" },
    mobiles: ["0770 123 4567"],
    tel: "+964 1 717 0000",
    email: "saadi@asiacell-test.com",
    website: "www.asiacell-test.com",
    city: "Baghdad",
    sector: BUSINESS,
  },
  {
    en: { name: "Sara Al-Jubouri", title: "Branch Manager", company: "Trade Bank of Iraq" },
    mobiles: ["+964 771 555 0199"],
    tel: "+964 1 543 2100",
    email: "sara.aljubouri@tbi-test.iq",
    city: "Baghdad",
    address: "Al-Mansour",
    sector: BUSINESS,
  },
  {
    en: { name: "Karwan Aziz", title: "Sales Director", company: "Zagros Construction Co." },
    mobiles: ["+964 750 441 7788"],
    email: "karwan.aziz@zagros-test.com",
    website: "www.zagros-test.com",
    city: "Erbil",
    sector: BUSINESS,
  },
  {
    en: { name: "Anna Schmidt", title: "Cultural Attaché", company: "Embassy of Germany" },
    mobiles: ["+964 783 222 1144"],
    email: "anna.schmidt@german-embassy-test.org",
    city: "Baghdad",
    sector: INTERNATIONAL,
  },
  {
    en: { name: "Rana Khalil", title: "Education Officer", company: "UNICEF Iraq" },
    mobiles: ["+964 750 888 1212"],
    tel: "+964 66 255 4400",
    email: "rkhalil@unicef-test.org",
    city: "Erbil",
    sector: INTERNATIONAL,
  },
  {
    en: {
      name: "Hassan Al-Tamimi",
      title: "Director of Planning",
      company: "Ministry of Planning",
    },
    mobiles: ["0790 123 4567"],
    email: "h.altamimi@mop-test.gov.iq",
    city: "Baghdad",
    sector: GOVERNMENT,
  },
  {
    en: {
      name: "Shirin Jalal",
      title: "Head of Computer Science Department",
      company: "University of Sulaimani",
    },
    mobiles: ["0772 876 5432"],
    email: "shirin.jalal@univsul-test.edu.iq",
    website: "www.univsul-test.edu.iq",
    city: "Sulaymaniyah",
    sector: EDUCATION,
  },
  {
    en: { name: "Soran Rasul", title: "Country Director", company: "Hiwa Development Foundation" },
    mobiles: ["+964 750 777 1234"],
    email: "soran@hiwa-foundation-test.org",
    website: "www.hiwa-foundation-test.org",
    city: "Erbil",
    sector: NGO,
  },
  {
    en: { name: "Bashar Al-Rawi", title: "Lawyer", company: "Al-Rawi Law Office" },
    mobiles: ["0790 111 2233", "0780 111 9933"],
    email: "bashar@alrawi-law-test.com",
    city: "Baghdad",
    address: "Karrada",
    sector: PROFESSIONAL,
  },
];

const ARABIC: Card[] = [
  {
    ar: {
      name: "أحمد الربيعي",
      title: "مدير عام دائرة البعثات",
      company: "وزارة التعليم العالي والبحث العلمي",
    },
    mobiles: ["٠٧٨٠ ١١١ ٢٢٣٣"],
    tel: "٠١ ٧١٩ ٤٤٠٠",
    email: "a.alrubaie@mohesr-test.gov.iq",
    city: "بغداد",
    sector: GOVERNMENT,
  },
  {
    ar: { name: "علي حسين الخفاجي", title: "مدير فرع", company: "مصرف الرافدين" },
    mobiles: ["0770 234 5678"],
    email: "ali.alkhafaji@rafidain-test.iq",
    city: "البصرة",
    address: "العشار",
    sector: BUSINESS,
  },
  {
    ar: { name: "فاطمة العبيدي", title: "مستشارة قانونية", company: "وزارة النفط" },
    mobiles: ["٠٧٧١ ٢٣٤ ٥٦٧٨"],
    email: "fatima.alobaidi@oil-test.gov.iq",
    city: "بغداد",
    sector: GOVERNMENT,
  },
  {
    ar: { name: "خالد العزاوي", title: "عميد كلية الهندسة", company: "جامعة بغداد" },
    mobiles: ["0783 555 6677"],
    tel: "01 778 5500",
    email: "khalid.alazzawi@uobaghdad-test.edu.iq",
    city: "بغداد",
    address: "الجادرية",
    sector: EDUCATION,
  },
  {
    ar: {
      name: "كرار الموسوي",
      title: "منسق مشاريع",
      company: "مؤسسة الغدير للرعاية الاجتماعية",
    },
    mobiles: ["0781 234 5678"],
    email: "karrar@alghadeer-test.org",
    city: "كربلاء",
    sector: NGO,
  },
  {
    ar: {
      name: "حيدر الأسدي",
      title: "مهندس استشاري",
      company: "مكتب الأسدي للاستشارات الهندسية",
    },
    mobiles: ["0772 345 6789"],
    email: "haider@alasadi-eng-test.com",
    city: "البصرة",
    sector: PROFESSIONAL,
  },
  {
    ar: { name: "عبد الله الجنابي", title: "مدير مركز التعليم المستمر", company: "جامعة الكوفة" },
    mobiles: ["0782 222 3344"],
    email: "abdullah.aljanabi@uokufa-test.edu.iq",
    website: "www.uokufa-test.edu.iq",
    city: "النجف",
    sector: EDUCATION,
  },
  {
    ar: { name: "رغد سلمان الطائي", title: "مديرة الموارد البشرية", company: "شركة نفط الشمال" },
    mobiles: ["٠٧٧٠ ٢٢٣ ٣٤٤١"],
    tel: "050 225 1100",
    fax: "050 225 1101",
    email: "raghad.altaie@noc-test.oil.iq",
    city: "كركوك",
    sector: BUSINESS,
  },
];

const BILINGUAL: Card[] = [
  {
    ar: { name: "زينب كاظم", title: "طبيبة أطفال", company: "مستشفى الكوفة الأهلي" },
    en: { name: "Zainab Kadhim", title: "Pediatrician", company: "Al-Kufa Private Hospital" },
    mobiles: ["0781 555 0142"],
    email: "dr.zainab@alkufa-hospital-test.com",
    city: "Najaf",
    sector: BUSINESS,
  },
  {
    ar: { name: "نور الهاشمي", title: "مديرة العلاقات العامة", company: "فندق بابل" },
    en: { name: "Noor Al-Hashimi", title: "Public Relations Manager", company: "Babylon Hotel" },
    mobiles: ["+964 750 332 1100"],
    tel: "+964 1 778 1964",
    email: "noor@babylonhotel-test.com",
    website: "www.babylonhotel-test.com",
    city: "Baghdad",
    sector: BUSINESS,
  },
  {
    ar: { name: "يوسف الشمري", title: "معاون المحافظ", company: "محافظة كربلاء" },
    en: { name: "Yousif Al-Shammari", title: "Deputy Governor", company: "Karbala Governorate" },
    mobiles: ["0782 100 4455"],
    tel: "032 331 0020",
    email: "y.alshammari@karbala-test.gov.iq",
    city: "Karbala",
    sector: GOVERNMENT,
  },
  {
    ar: { name: "سعد النعيمي", title: "أستاذ مساعد", company: "جامعة الموصل" },
    en: { name: "Saad Al-Nuaimi", title: "Assistant Professor", company: "University of Mosul" },
    mobiles: ["0751 987 6543"],
    email: "saad.alnuaimi@uomosul-test.edu.iq",
    city: "Mosul",
    sector: EDUCATION,
  },
  {
    ar: { name: "إيمان الزبيدي", title: "رئيسة الجمعية", company: "جمعية الأمل للمرأة" },
    en: { name: "Eman Al-Zubaidi", title: "President", company: "Al-Amal Women's Association" },
    mobiles: ["0773 456 7890"],
    email: "eman@alamal-women-test.org",
    city: "Baghdad",
    sector: NGO,
  },
  {
    ar: { name: "سامر البياتي", title: "مدير المبيعات", company: "شركة دجلة للأدوية" },
    en: { name: "Samer Al-Bayati", title: "Sales Manager", company: "Dijlah Pharma Co." },
    mobiles: ["+964 770 345 1188"],
    tel: "+964 1 778 2020",
    email: "samer@dijlahpharma-test.com",
    website: "www.dijlahpharma-test.com",
    city: "Baghdad",
    sector: BUSINESS,
  },
  {
    ar: { name: "مريم يعقوب", title: "مسؤولة برامج", company: "برنامج الأمم المتحدة الإنمائي" },
    en: { name: "Mariam Yaqoub", title: "Programme Officer", company: "UNDP Iraq" },
    mobiles: ["0783 345 6789"],
    email: "mariam.yaqoub@undp-test.org",
    city: "Baghdad",
    sector: INTERNATIONAL,
  },
];

type Table = "wood" | "dark" | "grey";

type Photo = {
  /** Carries the card count: p05-8-mixed. */
  name: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cards: Card[];
  table: Table;
  /** Largest tilt of a card, in degrees. */
  maxAngle: number;
  unevenLight?: boolean;
  /** The finished photo is turned 90° clockwise. */
  rotate90?: boolean;
};

const E = ENGLISH;
const A = ARABIC;
const B = BILINGUAL;

/** `pool[index]`, checked: a wrong index is a mistake in the lists below. */
function at(pool: Card[], index: number): Card {
  const card = pool[index];
  if (!card) throw new Error(`No card at index ${index}`);
  return card;
}

const PHOTOS: Photo[] = [
  {
    name: "p01-1-english",
    width: 1600,
    height: 1100,
    cols: 1,
    rows: 1,
    cards: [at(E, 0)],
    table: "wood",
    maxAngle: 2,
  },
  {
    name: "p02-1-arabic",
    width: 1600,
    height: 1100,
    cols: 1,
    rows: 1,
    cards: [at(A, 0)],
    table: "grey",
    maxAngle: 2,
  },
  {
    name: "p03-1-bilingual",
    width: 1600,
    height: 1100,
    cols: 1,
    rows: 1,
    cards: [at(B, 0)],
    table: "wood",
    maxAngle: 2,
  },
  {
    name: "p04-4-english",
    width: 2000,
    height: 1280,
    cols: 2,
    rows: 2,
    cards: [at(E, 1), at(E, 2), at(E, 3), at(E, 4)],
    table: "grey",
    maxAngle: 1,
  },
  {
    name: "p05-8-mixed",
    width: 1500,
    height: 2000,
    cols: 2,
    rows: 4,
    cards: [at(E, 5), at(A, 1), at(B, 1), at(E, 6), at(A, 2), at(B, 2), at(A, 3), at(E, 7)],
    table: "wood",
    maxAngle: 1,
  },
  {
    name: "p06-4-arabic-dark",
    width: 2000,
    height: 1280,
    cols: 2,
    rows: 2,
    cards: [at(A, 4), at(A, 5), at(A, 6), at(A, 7)],
    table: "dark",
    maxAngle: 1,
  },
  {
    name: "p07-4-mixed-rotated90",
    width: 2000,
    height: 1280,
    cols: 2,
    rows: 2,
    cards: [at(B, 3), at(E, 8), at(A, 0), at(B, 4)],
    table: "wood",
    maxAngle: 1,
    rotate90: true,
  },
  {
    name: "p08-12-angled-uneven",
    width: 2000,
    height: 1560,
    cols: 3,
    rows: 4,
    cards: [
      at(E, 0),
      at(A, 1),
      at(B, 0),
      at(A, 4),
      at(E, 3),
      at(B, 5),
      at(B, 2),
      at(A, 2),
      at(E, 1),
      at(E, 2),
      at(B, 6),
      at(A, 3),
    ],
    table: "wood",
    maxAngle: 5,
    unevenLight: true,
  },
  {
    name: "p09-8-angled",
    width: 2000,
    height: 1300,
    cols: 3,
    rows: 3,
    cards: [at(B, 5), at(A, 5), at(E, 4), at(A, 6), at(B, 6), at(E, 5), at(A, 7), at(E, 6)],
    table: "grey",
    maxAngle: 6,
  },
  {
    name: "p10-12-mixed-dark",
    width: 2000,
    height: 1560,
    cols: 3,
    rows: 4,
    cards: [
      at(A, 0),
      at(E, 8),
      at(B, 3),
      at(E, 7),
      at(B, 4),
      at(A, 6),
      at(B, 1),
      at(A, 7),
      at(E, 6),
      at(A, 5),
      at(E, 5),
      at(B, 2),
    ],
    table: "dark",
    maxAngle: 1,
  },
];

// ---------- Expected contacts ----------

const both = (ar: string | undefined, en: string | undefined) =>
  [ar, en].filter(Boolean).join(" / ");

/** The contact a careful reader would type from the card, after cleaning. */
function expectedContact(card: Card): ContactInput {
  const notes = [
    card.tel && `Office: ${card.tel}`,
    card.fax && `Fax: ${card.fax}`,
    card.website && `Website: ${card.website}`,
    card.address && `Address: ${card.address}`,
  ].filter(Boolean);
  return cleanContact({
    FullName: both(card.ar?.name, card.en?.name),
    Position: both(card.ar?.title, card.en?.title),
    Mobile: card.mobiles.join(", "),
    Company: both(card.ar?.company, card.en?.company),
    City: card.city,
    Email: card.email,
    Sector: card.sector,
    Notes: notes.join("; "),
  });
}

// ---------- Drawing ----------

/** Small seeded generator (mulberry32), so every run gives the same layout. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Keeps a left-to-right value (number, email) in printed order inside a right-to-left line.
 * An override, not an isolate: groups of Arabic-Indic digits would otherwise swap places.
 */
const ltr = (value: string) => `\u202d${value}\u202c`;

const ACCENTS = ["#0b5fa5", "#a3271f", "#1d7a4c", "#6a3d9a", "#b06a00", "#12707a"];
const PAPERS = ["#ffffff", "#fbf6e8", "#f7f9fc"];

type TextOptions = {
  x: number;
  y: number;
  size: number;
  maxWidth: number;
  bold?: boolean;
  rtl?: boolean;
  fill?: string;
};

/** One line of text. The size is reduced when the line would not fit (estimated width). */
function textLine(value: string, options: TextOptions): string {
  const { x, y, maxWidth, bold = false, rtl = false, fill = "#1b1b1b" } = options;
  const arabic = /[\u0600-\u06ff]/.test(value);
  const perChar = (arabic ? 0.47 : 0.52) + (bold ? 0.04 : 0);
  const size = Math.min(options.size, Math.floor(maxWidth / (value.length * perChar)));
  const weight = bold ? 700 : 400;
  const direction = rtl ? ` direction="rtl"` : "";
  // In right-to-left text the "start" anchor is the right edge.
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${direction}>${escapeXml(value)}</text>`;
}

/** The detail lines of a card, as printed. */
function detailLines(card: Card): string[] {
  const arabic = Boolean(card.ar) && !card.en;
  const lines: string[] = [];
  if (arabic) {
    lines.push(`موبايل: ${card.mobiles.map(ltr).join(" / ")}`);
    if (card.tel) lines.push(`هاتف: ${ltr(card.tel)}`);
    if (card.fax) lines.push(`فاكس: ${ltr(card.fax)}`);
    lines.push(ltr(card.email));
    if (card.website) lines.push(ltr(card.website));
    lines.push(card.address ? `${card.address} - ${card.city}` : `${card.city} - العراق`);
  } else {
    lines.push(`Mobile: ${card.mobiles.join(" / ")}`);
    if (card.tel) lines.push(`Tel: ${card.tel}`);
    if (card.fax) lines.push(`Fax: ${card.fax}`);
    lines.push(card.email);
    if (card.website) lines.push(card.website);
    lines.push(card.address ? `${card.address}, ${card.city}, Iraq` : `${card.city}, Iraq`);
  }
  return lines;
}

/** A card drawn in CARD_W × CARD_H units, with its top-left corner at 0,0. */
function cardSvg(card: Card, accent: string, paper: string): string {
  const parts: string[] = [
    `<rect x="12" y="16" width="${CARD_W}" height="${CARD_H}" rx="16" fill="#000" opacity="0.3"/>`,
    `<rect width="${CARD_W}" height="${CARD_H}" rx="16" fill="${paper}"/>`,
  ];
  const details = detailLines(card);
  const detailSize = 38;
  const detailStep = 53;

  if (card.ar && card.en) {
    // Bilingual: English on the left half, Arabic on the right half, details below.
    const half = CARD_W / 2 - 70;
    parts.push(`<rect width="${CARD_W}" height="14" fill="${accent}"/>`);
    parts.push(textLine(card.en.name, { x: 50, y: 95, size: 46, maxWidth: half, bold: true }));
    parts.push(textLine(card.en.title, { x: 50, y: 145, size: 31, maxWidth: half, fill: "#444" }));
    parts.push(
      textLine(card.en.company, {
        x: 50,
        y: 205,
        size: 34,
        maxWidth: half,
        bold: true,
        fill: accent,
      }),
    );
    const right = CARD_W - 50;
    parts.push(
      textLine(card.ar.name, { x: right, y: 95, size: 50, maxWidth: half, bold: true, rtl: true }),
    );
    parts.push(
      textLine(card.ar.title, {
        x: right,
        y: 145,
        size: 33,
        maxWidth: half,
        rtl: true,
        fill: "#444",
      }),
    );
    parts.push(
      textLine(card.ar.company, {
        x: right,
        y: 205,
        size: 36,
        maxWidth: half,
        bold: true,
        rtl: true,
        fill: accent,
      }),
    );
    parts.push(`<rect x="50" y="238" width="${CARD_W - 100}" height="3" fill="${accent}"/>`);
    details.forEach((line, index) => {
      const y = 305 + index * detailStep;
      parts.push(textLine(line, { x: 50, y, size: detailSize, maxWidth: CARD_W - 100 }));
    });
    return parts.join("");
  }

  const names = card.ar ?? card.en;
  if (!names) throw new Error("A card needs an Arabic or an English side");
  const rtl = Boolean(card.ar);
  const x = rtl ? CARD_W - 75 : 75;
  const maxWidth = CARD_W - 135;
  parts.push(`<rect x="${rtl ? CARD_W - 22 : 0}" width="22" height="${CARD_H}" fill="${accent}"/>`);
  parts.push(textLine(names.name, { x, y: 100, size: 60, maxWidth, bold: true, rtl }));
  parts.push(textLine(names.title, { x, y: 155, size: 36, maxWidth, rtl, fill: "#444" }));
  parts.push(
    textLine(names.company, { x, y: 222, size: 44, maxWidth, bold: true, rtl, fill: accent }),
  );
  parts.push(`<rect x="${rtl ? x - 260 : x}" y="250" width="260" height="4" fill="${accent}"/>`);
  details.forEach((line, index) => {
    const y = 318 + index * detailStep;
    parts.push(textLine(line, { x, y, size: detailSize, maxWidth, rtl }));
  });
  return parts.join("");
}

function tableSvg(table: Table, width: number, height: number, random: () => number): string {
  const colors: Record<Table, [string, string]> = {
    wood: ["#9a6b3f", "#6f4826"],
    dark: ["#2a2d33", "#121417"],
    grey: ["#c3c6ca", "#94989e"],
  };
  const [from, to] = colors[table];
  const parts = [
    `<defs><linearGradient id="table" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    `<rect width="${width}" height="${height}" fill="url(#table)"/>`,
  ];
  if (table === "wood") {
    // Grain: thin darker and lighter bands along the planks.
    for (let i = 0; i < 90; i++) {
      const y = Math.round(random() * height);
      const thickness = 1 + Math.round(random() * 5);
      const opacity = (0.05 + random() * 0.12).toFixed(2);
      const fill = random() < 0.7 ? "#3b2410" : "#d9b48a";
      parts.push(
        `<rect y="${y}" width="${width}" height="${thickness}" fill="${fill}" opacity="${opacity}"/>`,
      );
    }
    for (let i = 1; i < 4; i++) {
      const y = Math.round((height * i) / 4);
      parts.push(`<rect y="${y}" width="${width}" height="3" fill="#2a1808" opacity="0.5"/>`);
    }
  }
  return parts.join("");
}

function photoSvg(photo: Photo, random: () => number): string {
  const { width, height, cols, rows } = photo;
  const cellW = width / cols;
  const cellH = height / rows;
  // Tilted cards need more room so that neighbours do not overlap.
  const fill = photo.maxAngle > 2 ? 0.84 : 0.9;
  const scale = Math.min((cellW * fill) / CARD_W, (cellH * fill) / CARD_H);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    tableSvg(photo.table, width, height, random),
    `<g font-family="${FONT}">`,
  ];
  photo.cards.forEach((card, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = (col + 0.5) * cellW + (random() - 0.5) * cellW * 0.03;
    const cy = (row + 0.5) * cellH + (random() - 0.5) * cellH * 0.03;
    const angle = ((random() * 2 - 1) * photo.maxAngle).toFixed(2);
    const accent = ACCENTS[Math.floor(random() * ACCENTS.length)] ?? "#0b5fa5";
    const paper = PAPERS[Math.floor(random() * PAPERS.length)] ?? "#ffffff";
    parts.push(
      `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${angle}) scale(${scale.toFixed(4)}) translate(${-CARD_W / 2} ${-CARD_H / 2})">`,
      cardSvg(card, accent, paper),
      `</g>`,
    );
  });
  parts.push(`</g>`);
  if (photo.unevenLight) {
    // A lamp at the top-left: bright there, in shadow at the bottom-right.
    parts.push(
      `<defs><radialGradient id="light" cx="0.15" cy="0.1" r="1.25"><stop offset="0" stop-color="#fff8e0" stop-opacity="0.28"/><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.58"/></radialGradient></defs>`,
      `<rect width="${width}" height="${height}" fill="url(#light)"/>`,
    );
  }
  parts.push(`</svg>`);
  return parts.join("");
}

/** Cards in reading order of the finished photo: top-left to bottom-right, row by row. */
function readingOrder(photo: Photo): Card[] {
  if (!photo.rotate90) return photo.cards;
  // After a 90° clockwise turn, column c becomes row c, read from the last drawn row up.
  const ordered: Card[] = [];
  for (let col = 0; col < photo.cols; col++) {
    for (let row = photo.rows - 1; row >= 0; row--) {
      const card = photo.cards[row * photo.cols + col];
      if (card) ordered.push(card);
    }
  }
  return ordered;
}

async function main() {
  // The image library must see only the fixture fonts, never a system font:
  // point fontconfig at that folder before the library is loaded.
  const temp = mkdtempSync(path.join(os.tmpdir(), "photo-fixtures-"));
  const fontConfig = path.join(temp, "fonts.conf");
  writeFileSync(
    fontConfig,
    `<?xml version="1.0"?>\n<fontconfig><dir>${escapeXml(FONT_DIR)}</dir><cachedir>${escapeXml(path.join(temp, "cache"))}</cachedir></fontconfig>\n`,
  );
  process.env.FONTCONFIG_FILE = fontConfig;
  process.env.FONTCONFIG_PATH = temp;
  const { default: sharp } = await import("sharp");

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [index, photo] of PHOTOS.entries()) {
    const count = Number(photo.name.split("-")[1]);
    if (count !== photo.cards.length || new Set(photo.cards).size !== count) {
      throw new Error(`${photo.name}: the name must carry the number of (different) cards`);
    }
    const svg = photoSvg(photo, seeded(20260 + index));
    let image = sharp(Buffer.from(svg));
    if (photo.rotate90) image = image.rotate(90);
    const jpeg = await image.jpeg({ quality: 88 }).toBuffer();
    writeFileSync(path.join(OUT_DIR, `${photo.name}.jpg`), jpeg);

    const expected = readingOrder(photo).map(expectedContact);
    writeFileSync(
      path.join(OUT_DIR, `${photo.name}.expected.json`),
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    console.log(`${photo.name}: ${count} card(s), ${Math.round(jpeg.length / 1024)} KB`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
