"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { splitBilingual } from "@/lib/bilingual";
import { SECTORS } from "@/modules/contacts/contact.schema";
import { Button } from "./ui/button";
import { Input, Label, Select } from "./ui/input";

/** The table filters. "" = not set. Dates are `YYYY-MM-DD` in the app time zone. */
export type Filters = {
  CreatedBy: string;
  City: string;
  Sector: string;
  DepartmentId: string;
  dateFrom: string;
  dateTo: string;
};

export const NO_FILTERS: Filters = {
  CreatedBy: "",
  City: "",
  Sector: "",
  DepartmentId: "",
  dateFrom: "",
  dateTo: "",
};

export type Creator = { id: string; name: string; username: string; count: number };
export type ValueCount = { value: string; count: number };
export type DepartmentOption = { id: string; name: string; active: boolean };

type Props = {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  creators?: Creator[];
  cities?: ValueCount[];
  /** Only for High Management. */
  departments?: DepartmentOption[];
  /** The Export button (nothing for viewers). */
  children?: ReactNode;
};

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-36 flex-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function ExploreFilters({
  filters,
  onChange,
  onClear,
  creators = [],
  cities = [],
  departments,
  children,
}: Props) {
  const anySet = Object.values(filters).some(Boolean);
  // A chosen value stays in its list even when no contact has it any more.
  const cityMissing = filters.City && !cities.some((city) => city.value === filters.City);
  const creatorMissing =
    filters.CreatedBy && !creators.some((creator) => creator.id === filters.CreatedBy);

  return (
    <section aria-label="Filters" className="flex flex-wrap items-end gap-3">
      <Field id="filter-added-by" label="Added by">
        <Select
          id="filter-added-by"
          value={filters.CreatedBy}
          onChange={(event) => onChange({ CreatedBy: event.target.value })}
        >
          <option value="">Anyone</option>
          {creatorMissing ? <option value={filters.CreatedBy}>Selected person</option> : null}
          {creators.map((creator) => (
            <option key={creator.id} value={creator.id}>
              {creator.name || creator.username} ({creator.count})
            </option>
          ))}
        </Select>
      </Field>
      <Field id="filter-city" label="City">
        <Select
          id="filter-city"
          dir="auto"
          value={filters.City}
          onChange={(event) => onChange({ City: event.target.value })}
        >
          <option value="">All cities</option>
          {cityMissing ? <option value={filters.City}>{filters.City}</option> : null}
          {cities
            .filter((city) => city.value)
            .map((city) => (
              <option key={city.value} value={city.value}>
                {splitBilingual(city.value).join(" / ")} ({city.count})
              </option>
            ))}
        </Select>
      </Field>
      <Field id="filter-sector" label="Sector">
        <Select
          id="filter-sector"
          value={filters.Sector}
          onChange={(event) => onChange({ Sector: event.target.value })}
        >
          <option value="">All sectors</option>
          {SECTORS.map((sector) => (
            <option key={sector} value={sector}>
              {sector}
            </option>
          ))}
        </Select>
      </Field>
      {departments ? (
        <Field id="filter-department" label="Department">
          <Select
            id="filter-department"
            dir="auto"
            value={filters.DepartmentId}
            onChange={(event) => onChange({ DepartmentId: event.target.value })}
          >
            <option value="">All departments</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
                {department.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field id="filter-date-from" label="Date from">
        <Input
          id="filter-date-from"
          type="date"
          value={filters.dateFrom}
          max={filters.dateTo || undefined}
          onChange={(event) => onChange({ dateFrom: event.target.value })}
        />
      </Field>
      <Field id="filter-date-to" label="Date to">
        <Input
          id="filter-date-to"
          type="date"
          value={filters.dateTo}
          min={filters.dateFrom || undefined}
          onChange={(event) => onChange({ dateTo: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {anySet ? (
          <Button variant="ghost" onClick={onClear}>
            <X aria-hidden className="size-4" />
            Clear filters
          </Button>
        ) : null}
        {children}
      </div>
    </section>
  );
}
