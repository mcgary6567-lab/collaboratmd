import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { NAV_GROUPS } from "@/lib/nav";
import { ALWAYS_SHOWN } from "@/server/admin";
import { saveMenuAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Hide modules the practice does not use, for everyone. It tidies the menu; it does not restrict access. */
export default async function MenuPage() {
  const s = await requireSession();
  const [p] = await (await getDb()).select({ hidden: schema.practices.hiddenNav }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  const hidden = new Set(p?.hidden ?? []);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader title="Menu" subtitle="Untick what your practice does not use, such as dental claims for a medical practice. It tidies the menu for everyone; hidden pages still open from search and links, and roles still decide who can use them." />
      <ActionForm action={saveMenuAction} className="space-y-6">
        <fieldset disabled={!admin} className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {NAV_GROUPS.map((g) => (
            <Card key={g.title} title={g.title}>
              <ul className="space-y-2 text-sm">
                {g.items.map((i) => {
                  const fixed = ALWAYS_SHOWN.includes(i.href);
                  return (
                    <li key={i.href}>
                      <input type="hidden" name="all" value={i.href} />
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="show" value={i.href} defaultChecked={fixed || !hidden.has(i.href)} disabled={fixed} />
                        {fixed && <input type="hidden" name="show" value={i.href} />}
                        <i.icon className="h-4 w-4 text-slate-400" />
                        <span className={fixed ? "text-slate-500" : ""}>{i.label}</span>
                        {i.adminOnly && <span className="text-[10px] uppercase text-slate-400">admin</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </fieldset>
        {admin ? <SubmitButton pendingLabel="Saving...">Save menu</SubmitButton> : <p className="text-sm text-slate-500">An administrator sets the menu.</p>}
      </ActionForm>
    </>
  );
}
