import Link from "next/link";
import { connection } from "next/server";

/**
 * Rendered per request rather than built ahead of time, so it carries the
 * Content-Security-Policy nonce like every other page (see src/proxy.ts).
 */
export default async function NotFound() {
  await connection();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-green-800">404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">That page does not exist</h1>
        <p className="mt-2 text-sm text-slate-600">The link may be old, or the address mistyped. If you followed a link from a message we sent, ask the practice for a new one.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="btn btn-secondary">Home</Link>
          <Link href="/dashboard" className="btn btn-primary">Dashboard</Link>
        </div>
      </div>
    </main>
  );
}
