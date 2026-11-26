"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import {
  Building2,
  Camera,
  ClipboardList,
  LogOut,
  Menu,
  Search,
  Type,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { confirmLeave } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import { useMe } from "./MeProvider";
import { Dialog } from "./ui/dialog";

/** Placeholder logo until the owner supplies one. */
function Logo() {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-md bg-white text-sm font-bold text-primary-dark"
      >
        BC
      </span>
      <span className="text-sm leading-tight font-semibold">
        Business Cards
        <br />
        Manager
      </span>
    </span>
  );
}

type Item = { href: string; label: string; icon: ReactNode };

function NavLinks({ onNavigate }: { onNavigate: () => void }) {
  const me = useMe();
  const pathname = usePathname();

  const main: Item[] = [{ href: "/", label: "Explore", icon: <Search className="size-4" /> }];
  if (me.can.add) {
    main.push(
      { href: "/add/text", label: "Add from Text", icon: <Type className="size-4" /> },
      { href: "/add/photo", label: "Add from Photo", icon: <Camera className="size-4" /> },
    );
  }
  const admin: Item[] = me.can.admin
    ? [
        { href: "/admin/users", label: "Users", icon: <UserCog className="size-4" /> },
        {
          href: "/admin/departments",
          label: "Departments",
          icon: <Building2 className="size-4" />,
        },
        { href: "/admin/activity", label: "Activity", icon: <ClipboardList className="size-4" /> },
      ]
    : [];
  const footer: Item[] = [
    { href: "/team", label: "Team", icon: <Users className="size-4" /> },
    { href: "/account", label: "My account", icon: <UserRound className="size-4" /> },
  ];

  // A sidebar link asks before leaving a page with unsaved work.
  const guard = (event: MouseEvent) => {
    if (!confirmLeave()) event.preventDefault();
    else onNavigate();
  };

  const link = (item: Item) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={guard}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-white/90",
          "hover:bg-white/10 focus-visible:outline-white",
          active && "bg-white/15 text-white",
        )}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  };

  const signOut = async () => {
    if (!confirmLeave()) return;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  };

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      {main.map(link)}
      {admin.length > 0 ? (
        <>
          <p className="mt-4 px-3 text-xs font-semibold tracking-wide text-white/60 uppercase">
            Admin
          </p>
          {admin.map(link)}
        </>
      ) : null}
      <div className="mt-auto flex flex-col gap-1 border-t border-white/15 pt-3">
        {footer.map(link)}
        <div className="px-3 py-2 text-xs text-white/80">
          <p className="truncate text-sm font-semibold text-white" dir="auto">
            {me.user.name}
          </p>
          <p className="truncate" dir="auto">
            {me.department.name} · <span className="capitalize">{me.user.role}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-white/90 hover:bg-white/10 focus-visible:outline-white"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </nav>
  );
}

export function AppSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Wide screens: fixed sidebar. */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-primary-dark text-white lg:flex">
        <div className="p-4">
          <Logo />
        </div>
        <NavLinks onNavigate={() => {}} />
      </aside>

      {/* Small screens: top bar + the sidebar as a native dialog. */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-primary-dark px-3 py-2 text-white lg:hidden">
        <Logo />
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="flex size-11 items-center justify-center rounded-md hover:bg-white/10"
        >
          <Menu className="size-5" />
        </button>
      </header>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="Menu"
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] rounded-none bg-primary-dark text-white"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between p-3">
            <Logo />
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="flex size-11 items-center justify-center rounded-md hover:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      </Dialog>
    </>
  );
}
