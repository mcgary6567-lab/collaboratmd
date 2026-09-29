/** The app's navigation, shared by the sidebar (client) and the layout (server). */
import {
  Award, Bot, BuildingComplex, Calculator, CalendarDays, ChartColumn, ChartLine, ClipboardCheck, Clock, FaceSlightlySmiling, FileSpreadsheet, FileText, FlaskConical, FolderSearch, Gauge, Gavel, HandCoins,
  HeartPulse, Hospital, Inbox, Landmark, LayoutDashboard, ListChecks, MessageSquare, Network, Radar, Receipt, ReceiptText, Scale, RotateCcwClock, SearchCheck, Settings, SquareCheckBig, Stethoscope,
  TrendingDown, TriangleAlert, Undo2, Upload, UserSearch, Users, Wallet, WandSparkles,
} from "lucide-react";
import { settingsFor } from "./settings-sections";

export type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; multiOnly?: boolean };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "My work", icon: LayoutDashboard },
      { href: "/tasks", label: "Tasks", icon: SquareCheckBig },
      { href: "/work", label: "Work queues", icon: Inbox },
      { href: "/admin", label: "Practice analytics", icon: BuildingComplex, adminOnly: true },
      { href: "/clients", label: "All clients", icon: Network, multiOnly: true },
      { href: "/clients/invoicing", label: "Client invoicing", icon: ReceiptText, adminOnly: true },
    ],
  },
  {
    title: "Front desk",
    items: [
      { href: "/scheduling", label: "Scheduling", icon: CalendarDays },
      { href: "/scheduling/estimates", label: "Pre-visit estimates", icon: Calculator },
      { href: "/check-ins", label: "Online check-ins", icon: ClipboardCheck },
      { href: "/patients", label: "Patients", icon: Users },
      { href: "/messages", label: "Text messages", icon: MessageSquare },
      { href: "/patients/coverage-discovery", label: "Coverage discovery", icon: UserSearch },
      { href: "/labs", label: "Labs", icon: FlaskConical },
    ],
  },
  {
    title: "Billing",
    items: [
      { href: "/encounters/new", label: "Charge entry", icon: Stethoscope },
      { href: "/coding", label: "Coding help", icon: WandSparkles },
      { href: "/encounters/institutional", label: "Facility claim (UB-04)", icon: Hospital },
      { href: "/encounters/dental", label: "Dental claim (837D)", icon: FaceSlightlySmiling },
      { href: "/claims", label: "Claims", icon: FileText },
      { href: "/claims/follow-up", label: "Claim follow-up", icon: Clock },
      { href: "/remittance", label: "Remittance (ERA)", icon: Receipt },
      { href: "/remittance/deposits", label: "Bank deposits", icon: Landmark },
      { href: "/denials", label: "Denials", icon: TriangleAlert },
      { href: "/denials/agent", label: "Denial agent", icon: Bot },
      { href: "/underpayments", label: "Underpayments", icon: TrendingDown },
      { href: "/records-requests", label: "Records requests", icon: FolderSearch },
      { href: "/nsa-disputes", label: "Out-of-network disputes", icon: Scale },
      { href: "/refund-demands", label: "Payer refund demands", icon: Undo2 },
      { href: "/billing", label: "Patient billing", icon: Wallet },
      { href: "/billing/collections", label: "Collections", icon: Gavel },
      { href: "/billing/missed-charges", label: "Missed charges", icon: SearchCheck },
      { href: "/billing/credits", label: "Credits and refunds", icon: HandCoins },
      { href: "/billing/accounting", label: "Accounting", icon: FileSpreadsheet },
      { href: "/billing/legacy", label: "Previous system balances", icon: RotateCcwClock },
    ],
  },
  {
    title: "Reports and setup",
    items: [
      { href: "/reports", label: "Reports", icon: ChartColumn },
      { href: "/reports/forecast", label: "Cash forecast", icon: ChartLine },
      { href: "/reports/payer-alerts", label: "Payer alerts", icon: Radar },
      { href: "/reports/quality", label: "Quality (MIPS)", icon: Award },
      { href: "/reports/productivity", label: "Productivity (RVUs)", icon: Gauge, adminOnly: true },
      { href: "/reports/contracts", label: "Contract comparison", icon: Scale },
      { href: "/reports/lag", label: "Charge lag", icon: Clock },
      { href: "/reports/care-gaps", label: "Care gaps", icon: HeartPulse },
      { href: "/reports/fee-check", label: "Fee schedule check", icon: Receipt },
      { href: "/setup", label: "Setup checklist", icon: ListChecks, adminOnly: true },
      { href: "/import", label: "Import", icon: Upload },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Every page a user can open, for the search palette. */
export const ALL_PAGES = NAV_GROUPS.flatMap((g) => g.items);


/** Pages a user in `role` can open, for the search palette: the menu, then every settings page. */
export function pagesFor(role: string, multi: boolean) {
  const menu = ALL_PAGES.filter((i) => (!i.adminOnly || role === "admin") && (!i.multiOnly || multi)).map(({ href, label }) => ({ href, label }));
  const seen = new Set(menu.map((p) => p.href));
  const settings = settingsFor(role).flatMap((sec) => sec.links).filter((l) => !seen.has(l.href)).map(({ href, label }) => ({ href, label }));
  return [...menu, ...settings];
}
