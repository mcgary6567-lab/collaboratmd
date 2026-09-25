/**
 * Roles and what they can do. The four built-in roles stay as they are; a
 * custom role starts from one of them and switches abilities off. It never
 * grants more than its built-in role, so a custom role can only narrow access.
 */

export const BUILT_IN_ROLES: Record<string, string> = {
  admin: "Administrator",
  biller: "Biller",
  front_desk: "Front desk",
  readonly: "Read-only",
};

export type Capability = "write" | "adjust" | "export" | "reports" | "messages";

export const CAPABILITIES: { key: Capability; label: string; description: string; roles: string[] }[] = [
  { key: "write", label: "Day-to-day work", description: "Enter charges, work claims and denials, schedule, update patients", roles: ["admin", "biller", "front_desk"] },
  { key: "adjust", label: "Money", description: "Adjustments, write-offs, refunds and saving reports", roles: ["admin", "biller"] },
  { key: "messages", label: "Text messages", description: "Read and answer patients' texts", roles: ["admin", "biller", "front_desk"] },
  { key: "reports", label: "Reports", description: "Reports, cash forecast, payer alerts and the report builder", roles: ["admin", "biller", "front_desk", "readonly"] },
  { key: "export", label: "Exports", description: "Download data as CSV", roles: ["admin", "biller", "readonly"] },
];

/** Whether someone with this built-in role, minus these switched-off abilities, can do this. */
export function allows(role: string, denied: readonly string[] | undefined, cap: Capability): boolean {
  const def = CAPABILITIES.find((c) => c.key === cap);
  return !!def && def.roles.includes(role) && !(denied ?? []).includes(cap);
}
