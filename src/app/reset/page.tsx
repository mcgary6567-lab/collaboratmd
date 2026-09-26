import Link from "next/link";
import { getDb } from "@/db";
import { readResetToken } from "@/server/password-reset";
import { LogoMark } from "@/components/logo";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const user = token ? await readResetToken(await getDb(), token) : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-reset" />
          <h1 className="text-2xl font-bold">Choose a new password</h1>
        </div>
        <div className="card p-6 shadow-xl">
          {user ? (
            <>
              <p className="mb-4 text-sm text-slate-600">For <strong>{user.email}</strong>. Any device still signed in will be signed out.</p>
              <ResetForm token={token} />
            </>
          ) : (
            <p className="text-sm text-slate-700">This link has expired or was already used. <Link href="/login/forgot" className="text-brand-700 hover:underline">Ask for a new one</Link>.</p>
          )}
        </div>
      </div>
    </main>
  );
}
