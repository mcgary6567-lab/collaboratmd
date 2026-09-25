import Link from "next/link";
import { getDb } from "@/db";
import { readInvite } from "@/server/team";
import { LogoMark } from "@/components/logo";
import { WelcomeForm } from "./welcome-form";

export const dynamic = "force-dynamic";

/** Where an invite link lands: the new team member chooses a password. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const user = token ? await readInvite(await getDb(), token) : null;
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-welcome" />
          <h1 className="text-2xl font-bold">Welcome to CollaboratMD</h1>
        </div>
        <div className="card p-6 shadow-xl">
          {user ? (
            <>
              <p className="mb-4 text-sm text-slate-600">Hi {user.name}. Choose a password for <strong>{user.email}</strong>. You can turn on two-factor sign-in after.</p>
              <WelcomeForm token={token} />
            </>
          ) : (
            <p className="text-sm text-slate-700">This link has expired or was already used. Ask your practice administrator for a new one, or <Link href="/login" className="text-brand-700 hover:underline">sign in</Link>.</p>
          )}
        </div>
      </div>
    </main>
  );
}
