// npm run db:seed -- --department <name> [--sample] [--count N] [--reset]
import { readFileSync } from "node:fs";
import { z } from "zod";
import { findDepartmentByName } from "@/modules/accounts/departments.repo";
import { scriptWriter } from "@/modules/accounts/scope";
import { ContactInputLoose, SECTORS, type ContactInput } from "@/modules/contacts/contact.schema";
import { deleteAllContacts, insertContacts } from "@/modules/contacts/contacts.repo";
import { currentDatabaseName, withDb } from "@/modules/db/mongo";

const FIRST = [
  "Ahmed",
  "Mohammed",
  "Ali",
  "Hassan",
  "Omar",
  "Zainab",
  "Fatima",
  "Sara",
  "Noor",
  "Mustafa",
  "أحمد",
  "محمد",
  "علي",
  "حسن",
  "عمر",
  "زينب",
  "فاطمة",
  "سارة",
  "نور",
  "مصطفى",
];
const LAST = [
  "Al-Saadi",
  "Al-Rubaie",
  "Kareem",
  "Al-Tamimi",
  "Jasim",
  "Al-Obaidi",
  "Hussein",
  "الربيعي",
  "كاظم",
  "التميمي",
  "جاسم",
  "العبيدي",
  "حسين",
  "الساعدي",
];
const COMPANIES = [
  "Asiacell",
  "Korek Telecom",
  "Zain Iraq",
  "Rafidain Bank",
  "University of Baghdad",
  "Ministry of Higher Education",
  "UNICEF Iraq",
  "Basra Oil Company",
  "جامعة الموصل",
  "وزارة التخطيط",
  "مصرف الرشيد",
  "Iraqi Red Crescent",
  "Earthlink",
  "Al-Mansour Hospital",
];
const POSITIONS = [
  "Manager",
  "Engineer",
  "Director",
  "Lecturer",
  "Accountant",
  "Coordinator",
  "مدير",
  "مهندس",
  "محاسب",
  "أستاذ مساعد",
];
const CITIES = [
  "Baghdad",
  "Erbil",
  "Basra",
  "Najaf",
  "Mosul",
  "Karbala",
  "Sulaymaniyah",
  "Kirkuk",
  "بغداد",
  "البصرة",
];

/** Synthetic contacts for load tests. Deterministic, and every mobile is unique. */
function synthetic(count: number): ContactInput[] {
  const pick = <T>(list: T[], n: number) => list[n % list.length];
  return Array.from({ length: count }, (_, i) => ({
    FullName: `${pick(FIRST, i)} ${pick(LAST, Math.floor(i / FIRST.length) + i)} ${i + 1}`,
    Position: pick(POSITIONS, i * 7),
    Mobile: `077${String(10_000_000 + i).padStart(8, "0")}`,
    Company: pick(COMPANIES, i * 3),
    City: pick(CITIES, i * 5),
    Email: `person${i + 1}@example.test`,
    Sector: pick([...SECTORS], i),
    Notes: "",
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const departmentName = valueOf("--department");
  const count = valueOf("--count");
  const sample = args.includes("--sample");
  if (!departmentName || (!sample && !count)) {
    console.error("Usage: npm run db:seed -- --department <name> (--sample | --count N) [--reset]");
    process.exit(1);
  }

  await withDb(async () => {
    const department = await findDepartmentByName(departmentName);
    if (!department) {
      console.error(`Department "${departmentName}" not found. Create it in the app first.`);
      process.exit(1);
    }
    if (args.includes("--reset")) {
      if (!currentDatabaseName().includes("test")) {
        console.error('--reset only works when the database name contains "test".');
        process.exit(1);
      }
      console.log(`Deleted ${await deleteAllContacts()} contacts.`);
    }

    const writer = scriptWriter(department._id, "seed");
    let inputs: ContactInput[] = [];
    if (sample) {
      const raw = JSON.parse(readFileSync("tests/fixtures/sample-contacts.json", "utf8"));
      inputs = z.array(ContactInputLoose).parse(raw);
    }
    if (count)
      inputs = inputs.concat(synthetic(z.coerce.number().int().min(1).max(200_000).parse(count)));

    let done = 0;
    for (let i = 0; i < inputs.length; i += 1000) {
      done += (await insertContacts(writer, inputs.slice(i, i + 1000), "import")).length;
    }
    console.log(`Inserted ${done} contacts into ${department.name} (${currentDatabaseName()}).`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
