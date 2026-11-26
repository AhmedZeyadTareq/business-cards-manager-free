import { z } from "zod";

export const ROLES = ["viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Permission = "add" | "edit" | "delete" | "export" | "admin";
export type Permissions = Record<Permission, boolean>;

export function permissionsFor(role: Role): Permissions {
  const write = role === "editor" || role === "admin";
  return { add: write, edit: write, delete: write, export: write, admin: role === "admin" };
}

export const ROLE_NOTES: Record<Role, string> = {
  viewer: "Can search and view contacts.",
  editor: "Can add, edit, delete and export contacts.",
  admin: "Can do everything, and manage users and departments.",
};

export const HIGH_MANAGEMENT = "High Management";

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "3–32 characters: a-z, 0-9, dot, underscore, hyphen");
export const Password = z.string().min(8, "At least 8 characters").max(200);
const PersonName = z.string().trim().min(1, "Required").max(100);
const Id = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

export const LoginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: Password,
});

export const CreateUserBody = z.object({
  username: Username,
  name: PersonName,
  password: Password,
  departmentId: Id,
  role: z.enum(ROLES),
});
export type CreateUserInput = z.infer<typeof CreateUserBody>;

export const UpdateUserBody = z.object({
  name: PersonName.optional(),
  departmentId: Id.optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: Password.optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserBody>;

const DepartmentName = z.string().trim().min(2, "At least 2 characters").max(80);
export const CreateDepartmentBody = z.object({ name: DepartmentName });
export const UpdateDepartmentBody = z.object({
  name: DepartmentName.optional(),
  active: z.boolean().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentBody>;

export const PageQuery = (defaultSize: number) =>
  z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(defaultSize),
  });

/** A user as the API returns it: never the password hash. */
export type User = {
  id: string;
  username: string;
  name: string;
  departmentId: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Department = {
  id: string;
  name: string;
  isHighManagement: boolean;
  active: boolean;
  createdAt: string;
};

/** GET /api/me */
export type Me = {
  user: { id: string; username: string; name: string; role: Role };
  department: { id: string; name: string; isHighManagement: boolean };
  can: Permissions;
  /** IANA zone used for every displayed date and for "today". */
  timeZone: string;
  /** Only for High Management, which sees every department. */
  departments?: { id: string; name: string; active: boolean }[];
};

export type AuditItem = {
  id: string;
  at: string;
  username: string;
  action: "create" | "update" | "delete" | "export";
  contactId?: string;
  contactName?: string;
  departmentId?: string;
  count?: number;
  detail?: string;
};
