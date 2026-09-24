import { accessiblePractices, requireSession } from "@/lib/auth";
import { getDb } from "@/db";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const practices = await accessiblePractices(await getDb(), session.userId);
  return (
    <div className="flex min-h-screen">
      <Sidebar user={{ name: session.name, role: session.role }} logout={logoutAction} practices={practices.map((p) => ({ id: p.id, name: p.name }))} current={session.practiceId} />
      <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
