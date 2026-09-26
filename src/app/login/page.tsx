import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { LogoMark } from "@/components/logo";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ created?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { created } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-login" />
          <h1 className="text-2xl font-bold">CollaboratMD</h1>
          <p className="text-sm text-white/80">Medical billing and revenue cycle management</p>
        </div>
        <div className="card p-6 shadow-xl">
          {created && <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">Your practice is ready. Sign in with the email and password you chose; the setup guide takes it from there.</p>}
          <LoginForm />
          <p className="mt-4 flex justify-center gap-4 text-sm"><Link href="/login/forgot" className="text-brand-700 hover:underline">Forgot password?</Link><Link href="/login/sso" className="font-semibold text-brand-700 hover:underline">Sign in with SSO</Link></p>
          <p className="mt-2 text-center text-sm text-slate-600">New practice? <Link href="/signup" className="font-semibold text-brand-700 hover:underline">Start a free trial</Link></p>
          <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="mb-1 font-semibold">Demo accounts</div>
            <div>admin@collaboratmd.local / admin123</div>
            <div>biller@collaboratmd.local / biller123</div>
            <div>frontdesk@collaboratmd.local / front123</div>
          </div>
        </div>
      </div>
    </main>
  );
}
