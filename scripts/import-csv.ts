// npm run import:csv -- <file.csv> --department "<name>" [--dry-run] [--map FullName="Display Name"]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { findDepartmentByName } from "@/modules/accounts/departments.repo";
import { scriptWriter } from "@/modules/accounts/scope";
import { FIELDS, type ContactInput, type Field } from "@/modules/contacts/contact.schema";
import { findDuplicates, insertContacts } from "@/modules/contacts/contacts.repo";
import { decodeCsv, mapColumns, parseCsv, rowToContact } from "@/modules/contacts/import";
import { toMatchKeys } from "@/modules/contacts/normalize";
import { currentDatabaseName, withDb } from "@/modules/db/mongo";

type ReportRow = {
  line: number;
  result: "imported" | "skipped" | "failed";
  reason?: string;
  name?: string;
};

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(
    'Usage: npm run import:csv -- <file.csv> --department "<name>" [--dry-run] [--map Field="Header"]',
  );
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  let file: string | undefined;
  let departmentName: string | undefined;
  const overrides: Partial<Record<Field, string>> = {};
  const dryRun = args.includes("--dry-run");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") continue;
    if (arg === "--department") departmentName = args[++i];
    else if (arg === "--map") {
      const [field, ...rest] = (args[++i] ?? "").split("=");
      if (!(FIELDS as readonly string[]).includes(field) || rest.length === 0) {
        usage(`--map needs Field="Header" with Field one of: ${FIELDS.join(", ")}`);
      }
      overrides[field as Field] = rest.join("=").replace(/^"|"$/g, "");
    } else if (!arg.startsWith("--")) file ??= arg;
    else usage(`Unknown option ${arg}`);
  }
  if (!file || !departmentName) usage();

  const rows = parseCsv(decodeCsv(readFileSync(file)));
  if (rows.length < 2) usage("The file has no data rows.");
  const headers = rows[0];
  const mapping = mapColumns(headers, overrides);

  console.log("Column mapping:");
  headers.forEach((header, index) => {
    console.log(
      `  ${header.trim() || `(column ${index + 1})`} → ${mapping[index] ?? "Notes (as “Header: value”)"}`,
    );
  });
  if (!mapping.includes("FullName") && !mapping.includes("Company")) {
    usage(
      '\nNo name or company column was found. Use --map FullName="<header>" or --map Company="<header>".',
    );
  }

  await withDb(async () => {
    const department = await findDepartmentByName(departmentName);
    if (!department) usage(`Department "${departmentName}" not found. Create it in the app first.`);
    const writer = scriptWriter(department._id, "import-csv");

    const report: ReportRow[] = [];
    const candidates: { line: number; contact: ContactInput }[] = [];
    rows.slice(1).forEach((row, index) => {
      const line = index + 2;
      const result = rowToContact(row, headers, mapping);
      if (result.kind === "contact") candidates.push({ line, contact: result.contact });
      else
        report.push({
          line,
          result: result.kind === "skip" ? "skipped" : "failed",
          reason: result.reason,
        });
    });

    // Duplicates: already in the department, or earlier in the file (also across batches).
    const seen = new Set<string>();
    for (let start = 0; start < candidates.length; start += 500) {
      const batch = candidates.slice(start, start + 500);
      const marked = await findDuplicates(
        department._id,
        batch.map((item) => item.contact),
      );
      const fresh: typeof batch = [];
      batch.forEach((item, index) => {
        const name = item.contact.FullName || item.contact.Company;
        const keys = toMatchKeys(item.contact);
        const all = [...keys._mobiles, ...keys._emails];
        const mark = marked[index];
        if (mark.duplicateOfId) {
          report.push({
            line: item.line,
            result: "skipped",
            reason: `already saved: ${mark.duplicateOfName}`,
            name,
          });
        } else if (mark.duplicateInBatch !== undefined || all.some((key) => seen.has(key))) {
          report.push({
            line: item.line,
            result: "skipped",
            reason: "same mobile or email as an earlier row",
            name,
          });
        } else {
          fresh.push(item);
        }
        all.forEach((key) => seen.add(key));
      });
      if (fresh.length === 0) continue;
      try {
        if (!dryRun)
          await insertContacts(
            writer,
            fresh.map((item) => item.contact),
            "import",
          );
        for (const item of fresh) {
          report.push({
            line: item.line,
            result: "imported",
            name: item.contact.FullName || item.contact.Company,
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        for (const item of fresh) report.push({ line: item.line, result: "failed", reason });
      }
    }

    report.sort((a, b) => a.line - b.line);
    const count = (result: ReportRow["result"]) =>
      report.filter((row) => row.result === result).length;
    console.log(
      `\n${dryRun ? "DRY RUN — nothing was saved. Would import" : "Imported"}: ${count("imported")} · ` +
        `skipped: ${count("skipped")} · failed: ${count("failed")}  (department "${department.name}", database "${currentDatabaseName()}")`,
    );
    for (const row of report.filter((item) => item.result !== "imported")) {
      console.log(`  line ${row.line}: ${row.result} — ${row.reason}`);
    }

    mkdirSync("import-reports", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `import-reports/${basename(file).replace(/\.[^.]+$/, "")}-${stamp}${dryRun ? "-dry-run" : ""}.json`;
    writeFileSync(
      path,
      JSON.stringify(
        {
          file,
          department: department.name,
          dryRun,
          mapping: headers.map((header, i) => ({ header, field: mapping[i] })),
          imported: count("imported"),
          skipped: count("skipped"),
          failed: count("failed"),
          rows: report,
        },
        null,
        2,
      ),
    );
    console.log(`Report: ${path}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
