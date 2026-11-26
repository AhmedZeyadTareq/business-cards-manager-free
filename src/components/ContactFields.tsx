"use client";

import { FIELDS, SECTORS, type ContactInput, type Field } from "@/modules/contacts/contact.schema";
import { invalidEmails, normalizeMobile, unusualMobiles } from "@/modules/contacts/normalize";
import { cn } from "@/lib/utils";
import { Input, Label, Select, Textarea } from "./ui/input";

export const FIELD_LABELS: Record<Field, string> = {
  FullName: "Full name",
  Position: "Position",
  Mobile: "Mobile",
  Company: "Company",
  City: "City",
  Email: "Email",
  Sector: "Sector",
  Notes: "Notes",
};

type Props = {
  /** Makes the input ids unique when several contacts are on the page. */
  idPrefix: string;
  value: ContactInput;
  onChange: (field: Field, value: string) => void;
  readOnly?: boolean;
  className?: string;
};

/** The 8 contact fields, used by the contact dialog and the review list. */
export function ContactFields({ idPrefix, value, onChange, readOnly, className }: Props) {
  const badEmails = invalidEmails(value.Email);
  const oddMobiles = readOnly ? [] : unusualMobiles(normalizeMobile(value.Mobile));

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {FIELDS.map((field) => {
        const id = `${idPrefix}-${field}`;
        const common = {
          id,
          value: value[field],
          readOnly,
          dir: "auto" as const,
        };
        return (
          <div key={field} className={field === "Notes" ? "sm:col-span-2" : undefined}>
            <Label htmlFor={id}>{FIELD_LABELS[field]}</Label>
            {field === "Sector" ? (
              <Select
                id={id}
                value={value.Sector}
                disabled={readOnly}
                onChange={(event) => onChange(field, event.target.value)}
              >
                {SECTORS.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </Select>
            ) : field === "Notes" ? (
              <Textarea
                {...common}
                rows={3}
                maxLength={2000}
                onChange={(event) => onChange(field, event.target.value)}
              />
            ) : (
              <Input
                {...common}
                maxLength={300}
                inputMode={field === "Mobile" ? "tel" : field === "Email" ? "email" : undefined}
                autoComplete="off"
                aria-invalid={field === "Email" && badEmails.length > 0 ? true : undefined}
                aria-describedby={
                  field === "Email" && badEmails.length > 0
                    ? `${id}-error`
                    : field === "Mobile" && oddMobiles.length > 0
                      ? `${id}-hint`
                      : undefined
                }
                onChange={(event) => onChange(field, event.target.value)}
              />
            )}
            {field === "Email" && badEmails.length > 0 ? (
              <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
                Not a valid email: <span dir="auto">{badEmails.join(", ")}</span>
              </p>
            ) : null}
            {field === "Mobile" && oddMobiles.length > 0 ? (
              <p id={`${id}-hint`} className="mt-1 text-xs text-amber-700">
                Check this number: <span dir="ltr">{oddMobiles.join(", ")}</span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
