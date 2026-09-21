import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="flex min-h-screen">
      <Sidebar user={{ name: session.name, role: session.role }} logout={logoutAction} />
      <main className="min-w-0 flex-1 p-6 lg:p-8">{children}</main>
    </div>
  );
}
