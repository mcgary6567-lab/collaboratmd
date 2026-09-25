import Link from "next/link";
import { LogoMark } from "@/components/logo";

export const dynamic = "force-dynamic";

/** Sign in through the practice's identity provider: the email's domain picks the practice. */
export default async function SsoLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-sso" />
          <h1 className="text-2xl font-bold">Sign in with SSO</h1>
          <p className="text-sm text-white/80">Use your organization&apos;s account</p>
        </div>
        <div className="card p-6 shadow-xl">
          {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <form action="/api/sso/start" method="get" className="space-y-4">
            <label className="block">
              <span className="label">Work email</span>
              <input name="email" type="email" className="input" autoComplete="username" required />
            </label>
            <button className="btn w-full justify-center bg-green-600 text-white hover:bg-green-700">Continue</button>
          </form>
          <p className="mt-4 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Sign in with a password instead</Link></p>
        </div>
      </div>
    </main>
  );
}
