import { redirect } from "next/navigation";
import { getSession, hasPendingMfa } from "@/lib/auth";
import { LogoMark } from "@/components/logo";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  if (await getSession()) redirect("/dashboard");
  if (!(await hasPendingMfa())) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-verify" />
          <h1 className="text-2xl font-bold">Two-factor sign-in</h1>
          <p className="text-sm text-white/80">Enter the 6-digit code from your authenticator app.</p>
        </div>
        <div className="card p-6 shadow-xl">
          <VerifyForm />
          <p className="mt-4 text-xs text-slate-500">Lost your phone? Enter one of your recovery codes instead. Each works once.</p>
        </div>
      </div>
    </main>
  );
}
