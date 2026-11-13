import { PageHeader } from "@/components/PageHeader";
import { initials } from "@/lib/bilingual";

type TeamMember = { name: string; role: string; placeholder?: boolean };

// OWNER: replace these placeholder entries with the real people behind the app.
// One line per person: `name` may be English, Arabic or "English / العربية".
// Remove `placeholder: true` from a line once it holds a real name.
const TEAM: TeamMember[] = [
  { name: "Name to be added", role: "Project owner", placeholder: true },
  { name: "Name to be added", role: "Developer", placeholder: true },
  { name: "Name to be added", role: "Department coordinator", placeholder: true },
];

export default function Page() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Team">The people behind Business Cards Manager.</PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEAM.map((member, index) => (
          <li
            key={index}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4"
          >
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary"
            >
              {member.placeholder ? "?" : initials(member.name)}
            </span>
            <div className="min-w-0">
              <p
                dir="auto"
                className={
                  member.placeholder
                    ? "text-sm font-medium break-words text-zinc-400 italic"
                    : "text-sm font-semibold break-words text-zinc-900"
                }
              >
                {member.name}
              </p>
              <p className="text-sm text-zinc-600">{member.role}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
