"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, CalendarDays, FileText, Receipt, AlertTriangle, BarChart3, Settings, LogOut, Stethoscope, Building2, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/logo";

const NAV = [
  { href: "/dashboard", label: "My work", icon: LayoutDashboard },
  { href: "/admin", label: "Practice analytics", icon: Building2, adminOnly: true },
  { href: "/scheduling", label: "Scheduling", icon: CalendarDays },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/encounters/new", label: "Charge Entry", icon: Stethoscope },
  { href: "/claims", label: "Claims", icon: FileText },
  { href: "/remittance", label: "Remittance (ERA)", icon: Receipt },
  { href: "/denials", label: "Denials", icon: AlertTriangle },
  { href: "/underpayments", label: "Underpayments", icon: TrendingDown },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ user, logout }: { user: { name: string; role: string }; logout: () => Promise<void> }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <LogoMark className="h-9 w-9" id="cmd-sidebar" />
        <div>
          <div className="text-sm font-bold leading-tight">CollaboratMD</div>
          <div className="text-[11px] text-slate-500">Revenue cycle platform</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.filter((item) => !item.adminOnly || user.role === "admin").map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link key={href} href={href} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 p-4">
        <div className="text-sm font-semibold">{user.name}</div>
        <div className="mb-3 text-xs capitalize text-slate-500">{user.role.replace("_", " ")}</div>
        <form action={logout}>
          <button className="btn btn-secondary w-full justify-center text-xs">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
