/**
 * The demo practice: a seeded practice with fictional patients, whose sign-ins
 * are published (they are in the seed and the public repository). Visitors try
 * it from /demo in one click; the sign-in page never shows or pre-fills them.
 *
 * On the production deployment (Vercel sets VERCEL_ENV=production) the demo is
 * closed unless DEMO_LOGINS=on: its accounts cannot sign in at all, so a
 * published password opens nothing. Everywhere else (local, CI, previews) it is
 * open unless DEMO_LOGINS=off. Running the demo on its own deployment, with its
 * own database, is better still.
 */
export const DEMO_ACCOUNTS = {
  biller: { email: "biller@collaboratmd.local", label: "Biller", does: "Claims, denials, payments and patient balances" },
  front_desk: { email: "frontdesk@collaboratmd.local", label: "Front desk", does: "Scheduling, check-in, texts and payments at the desk" },
  admin: { email: "admin@collaboratmd.local", label: "Administrator", does: "Everything, plus settings, team, analytics and compliance" },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

export const isDemoEmail = (email: string | null | undefined) => !!email && /@collaboratmd\.local$/i.test(email.trim());

export const onProduction = () => process.env.VERCEL_ENV === "production";

export function demoOpen() {
  if (process.env.DEMO_LOGINS === "on") return true;
  if (process.env.DEMO_LOGINS === "off") return false;
  return !onProduction();
}

/** Where "see the demo" buttons go: the live demo when it is open, otherwise a request for a guided one. */
export function demoLink() {
  return demoOpen() ? { href: "/demo", open: true } : { href: "/contact?topic=sales", open: false };
}
