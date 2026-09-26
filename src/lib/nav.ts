/** The app's navigation, shared by the sidebar (client) and the layout (server). */
import {
  AlertTriangle, BarChart3, Building2, CalendarDays, CheckSquare, ClipboardCheck, Clock, FileText, FlaskConical, LayoutDashboard,
  ListChecks, Network, Receipt, Settings, Stethoscope, TrendingDown, Upload, Users, Wallet, Wand2, Landmark, Gavel, BadgeCheck, Plug, Code2, Bot, Hospital, ShieldCheck, BookCheck, SearchCheck, HandCoins, LineChart, Radar, MessageSquare, UserSearch, UsersRound, KeyRound, Inbox, FileSpreadsheet, ReceiptText, Smile, Calculator, History,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; multiOnly?: boolean };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "My work", icon: LayoutDashboard },
      { href: "/tasks", label: "Tasks", icon: CheckSquare },
      { href: "/work", label: "Work queues", icon: Inbox },
      { href: "/admin", label: "Practice analytics", icon: Building2, adminOnly: true },
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
      { href: "/coding", label: "Coding help", icon: Wand2 },
      { href: "/encounters/institutional", label: "Facility claim (UB-04)", icon: Hospital },
      { href: "/encounters/dental", label: "Dental claim (837D)", icon: Smile },
      { href: "/claims", label: "Claims", icon: FileText },
      { href: "/claims/follow-up", label: "Claim follow-up", icon: Clock },
      { href: "/remittance", label: "Remittance (ERA)", icon: Receipt },
      { href: "/remittance/deposits", label: "Bank deposits", icon: Landmark },
      { href: "/denials", label: "Denials", icon: AlertTriangle },
      { href: "/denials/agent", label: "Denial agent", icon: Bot },
      { href: "/underpayments", label: "Underpayments", icon: TrendingDown },
      { href: "/billing", label: "Patient billing", icon: Wallet },
      { href: "/billing/collections", label: "Collections", icon: Gavel },
      { href: "/billing/missed-charges", label: "Missed charges", icon: SearchCheck },
      { href: "/billing/credits", label: "Credits and refunds", icon: HandCoins },
      { href: "/billing/accounting", label: "Accounting", icon: FileSpreadsheet },
      { href: "/billing/legacy", label: "Previous system balances", icon: History },
    ],
  },
  {
    title: "Insights and setup",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/reports/forecast", label: "Cash forecast", icon: LineChart },
      { href: "/reports/payer-alerts", label: "Payer alerts", icon: Radar },
      { href: "/setup", label: "Setup checklist", icon: ListChecks, adminOnly: true },
      { href: "/settings/enrollment", label: "Payer enrollment", icon: BadgeCheck },
      { href: "/settings/team", label: "Team and roles", icon: UsersRound, adminOnly: true },
      { href: "/settings/sso", label: "Single sign-on", icon: KeyRound, adminOnly: true },
      { href: "/settings/connections", label: "Integrations", icon: Plug, adminOnly: true },
      { href: "/settings/developers", label: "Developers (API)", icon: Code2, adminOnly: true },
      { href: "/settings/compliance", label: "Compliance", icon: ShieldCheck, adminOnly: true },
      { href: "/settings/code-sets", label: "Code sets (NCCI)", icon: BookCheck, adminOnly: true },
      { href: "/import", label: "Import", icon: Upload },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Every page a user can open, for the search palette. */
export const ALL_PAGES = NAV_GROUPS.flatMap((g) => g.items);


/** Pages a user in `role` can open, for the search palette. */
export function pagesFor(role: string, multi: boolean) {
  return ALL_PAGES.filter((i) => (!i.adminOnly || role === "admin") && (!i.multiOnly || multi)).map(({ href, label }) => ({ href, label }));
}
