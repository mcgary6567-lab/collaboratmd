import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { BUILT_IN_ROLES, CAPABILITIES } from "@/lib/capabilities";
import { listCustomRoles, listTeam } from "@/server/team";
import { deleteRoleAction, inviteAction, inviteLinkAction, saveRoleAction, setActiveAction, setRoleAction } from "@/app/(app)/access-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { signOutUserAction } from "@/app/(app)/admin-actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { RevealForm } from "../developers/reveal-form";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const s = await requireSession();
  const db = await getDb();
  const [team, roles] = await Promise.all([listTeam(db, s.practiceId), listCustomRoles(db, s.practiceId)]);
  const admin = s.role === "admin";
  const roleOptions = [...Object.entries(BUILT_IN_ROLES).map(([k, v]) => ({ value: k, label: v })), ...roles.map((r) => ({ value: `custom:${r.id}`, label: `${r.name} (custom)` }))];

  return (
    <>
      <PageHeader title="Team and roles" subtitle="Who can use this practice, and what each role can do" actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`People · ${team.filter((m) => !m.disabled).length} active`} className="xl:col-span-2">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Two-factor</th><th /></tr></thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.userId} className={m.disabled ? "opacity-60" : ""}>
                  <td>
                    <div className="font-medium">{m.name} {m.userId === s.userId && <span className="text-xs text-slate-500">(you)</span>}</div>
                    <div className="text-xs text-slate-500">{m.email}{!m.home && " · from another practice"}</div>
                  </td>
                  <td>
                    {admin && !m.disabled ? (
                      <ActionForm action={setRoleAction.bind(null, m.userId)} className="flex items-center gap-1">
                        <select name="role" defaultValue={m.role} className="input w-auto py-1 text-xs">
                          {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Save</SubmitButton>
                      </ActionForm>
                    ) : m.roleLabel}
                  </td>
                  <td>{m.mfa ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    {m.disabled ? <Badge tone="red">deactivated</Badge> : null}
                    {admin && m.userId !== s.userId && (
                      <div className="mt-1 flex justify-end gap-2">
                        {m.home && !m.disabled && (
                          <details className="text-left">
                            <summary className="btn btn-secondary cursor-pointer px-2 py-1 text-xs">Invite link</summary>
                            <div className="mt-2 w-72"><RevealForm action={inviteLinkAction.bind(null, m.userId)} label="Make a new link"><span /></RevealForm></div>
                          </details>
                        )}
                        {!m.disabled && (
                          <ActionForm action={signOutUserAction.bind(null, m.userId)}>
                            <SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Sign out</SubmitButton>
                          </ActionForm>
                        )}
                        {(m.home || !m.disabled) && (
                          <ActionForm action={setActiveAction.bind(null, m.userId, m.disabled)}>
                            <SubmitButton className={`btn btn-secondary px-2 py-1 text-xs ${m.disabled ? "" : "text-red-700"}`} pendingLabel="...">{m.disabled ? "Reactivate" : "Remove access"}</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {admin && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="mb-2 text-sm font-semibold">Add someone</h3>
              <RevealForm action={inviteAction} className="flex flex-wrap items-end gap-2" label="Add">
                <label className="block text-xs">Name<input name="name" className="input mt-1 w-44" required /></label>
                <label className="block text-xs">Work email<input name="email" type="email" className="input mt-1 w-56" required /></label>
                <label className="block text-xs">Role
                  <select name="role" defaultValue="front_desk" className="input mt-1 w-44">
                    {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              </RevealForm>
              <p className="mt-2 text-xs text-slate-500">A new person gets a one-time link to choose a password. With single sign-on and automatic accounts on, people can simply sign in with SSO instead.</p>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="What each role can do">
            <table className="w-full text-xs">
              <thead><tr><th className="py-1 text-left font-semibold">Ability</th>{Object.values(BUILT_IN_ROLES).map((l) => <th key={l} className="px-1 text-center font-semibold">{l.split(" ")[0]}</th>)}</tr></thead>
              <tbody>
                {CAPABILITIES.map((c) => (
                  <tr key={c.key} className="border-t border-slate-100">
                    <td className="py-1" title={c.description}>{c.label}</td>
                    {Object.keys(BUILT_IN_ROLES).map((r) => <td key={r} className="text-center">{c.roles.includes(r) ? "✓" : "–"}</td>)}
                  </tr>
                ))}
                <tr className="border-t border-slate-100"><td className="py-1">Settings, team, integrations</td>{Object.keys(BUILT_IN_ROLES).map((r) => <td key={r} className="text-center">{r === "admin" ? "✓" : "–"}</td>)}</tr>
              </tbody>
            </table>
          </Card>

          <Card title="Custom roles">
            <p className="mb-3 text-xs text-slate-600">Start from a built-in role and switch abilities off, for example a biller who cannot export data, or front desk staff who do not handle texts. A custom role never grants more than the role it starts from.</p>
            {roles.length > 0 && (
              <ul className="mb-4 space-y-2 text-sm">
                {roles.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-slate-500">{BUILT_IN_ROLES[r.baseRole]}{r.denied.length ? `, without ${r.denied.map((d) => CAPABILITIES.find((c) => c.key === d)?.label.toLowerCase()).join(", ")}` : ""}</div>
                    </div>
                    {admin && <ActionForm action={deleteRoleAction.bind(null, r.id)}><SubmitButton className="btn btn-secondary px-2 py-1 text-xs" pendingLabel="...">Delete</SubmitButton></ActionForm>}
                  </li>
                ))}
              </ul>
            )}
            {admin && (
              <ActionForm action={saveRoleAction} className="space-y-2 text-sm">
                <input name="name" className="input" placeholder="Role name, e.g. Coder" required maxLength={60} />
                <select name="baseRole" defaultValue="biller" className="input">
                  {Object.entries(BUILT_IN_ROLES).map(([k, v]) => <option key={k} value={k}>Starts from {v}</option>)}
                </select>
                <fieldset className="space-y-1 text-xs">
                  <legend className="mb-1 font-semibold">Switch off</legend>
                  {CAPABILITIES.map((c) => <label key={c.key} className="flex items-center gap-2"><input type="checkbox" name="denied" value={c.key} /> {c.label} <span className="text-slate-500">({c.description.toLowerCase()})</span></label>)}
                </fieldset>
                <SubmitButton pendingLabel="Saving...">Save role</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
