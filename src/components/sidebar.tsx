"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, LogOut, Menu, Moon, Search, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";
import { PracticeSwitcher } from "@/components/practice-switcher";
import { openSearch } from "@/components/command-palette";
import { ALL_PAGES, NAV_GROUPS } from "@/lib/nav";

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  return (
    <button
      type="button"
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
      title={dark ? "Light mode" : "Dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => {
        const next = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document.cookie = `cmd_theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setDark(!dark);
      }}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function NavLinks({ role, multi, onNavigate }: { role: string; multi: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // The longest matching link is the active one, so /claims/follow-up does not also light up /claims.
  const visible = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => (!i.adminOnly || role === "admin") && (!i.multiOnly || multi)) })).filter((g) => g.items.length);
  const activeHref = ALL_PAGES.map((i) => i.href).filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
      {visible.map((g) => (
        <div key={g.title}>
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{g.title}</div>
          <div className="space-y-0.5">
            {g.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                className={cn("flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium", href === activeHref ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({
  user,
  logout,
  practices,
  current,
  tasks,
}: {
  user: { name: string; role: string };
  logout: () => Promise<void>;
  practices: { id: string; name: string }[];
  current: string;
  tasks: { open: number; due: number };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const multi = practices.length > 1;

  const footer = (
    <div className="border-t border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          <div className="text-xs capitalize text-slate-500">{user.role.replace("_", " ")}</div>
        </div>
        <ThemeToggle />
      </div>
      <form action={logout} className="mt-3">
        <button className="btn btn-secondary w-full justify-center text-xs">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </form>
    </div>
  );

  const bell = (
    <Link href="/tasks" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" title={`${tasks.open} open tasks, ${tasks.due} due`} aria-label={`Tasks: ${tasks.open} open, ${tasks.due} due`}>
      <Bell className="h-4 w-4" />
      {tasks.open > 0 && (
        <span className={`absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white ${tasks.due > 0 ? "bg-red-600" : "bg-brand-600"}`}>
          {tasks.open > 99 ? "99+" : tasks.open}
        </span>
      )}
    </Link>
  );

  const searchButton = (
    <button type="button" onClick={openSearch} className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100">
      <Search className="h-3.5 w-3.5" /> Search
      <kbd className="ml-auto rounded border border-slate-200 bg-white px-1 font-mono text-[10px]">Ctrl K</kbd>
    </button>
  );

  return (
    <>
      {/* Phone and tablet: a top bar and a slide-out menu. */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 md:hidden">
        <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <LogoMark className="h-7 w-7" id="cmd-topbar" />
        <span className="text-sm font-bold">CollaboratMD</span>
        <button type="button" className="ml-auto rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Search" onClick={openSearch}>
          <Search className="h-5 w-5" />
        </button>
        {bell}
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center gap-2 px-5 py-4">
              <LogoMark className="h-8 w-8" id="cmd-drawer" />
              <span className="text-sm font-bold">CollaboratMD</span>
              <button type="button" className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close menu" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <PracticeSwitcher practices={practices} current={current} />
            <NavLinks role={user.role} multi={multi} onNavigate={() => setOpen(false)} />
            {footer}
          </aside>
        </div>
      )}

      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <LogoMark className="h-9 w-9" id="cmd-sidebar" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold leading-tight">CollaboratMD</div>
            <div className="text-[11px] text-slate-500">Revenue cycle platform</div>
          </div>
          {bell}
        </div>
        <PracticeSwitcher practices={practices} current={current} />
        {searchButton}
        <NavLinks role={user.role} multi={multi} />
        {footer}
      </aside>
    </>
  );
}
