import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { ForgotForm } from "./forgot-form";

export default function ForgotPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-700 to-green-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <LogoMark className="mx-auto mb-3 h-12 w-12" id="cmd-forgot" />
          <h1 className="text-2xl font-bold">Forgot your password?</h1>
          <p className="text-sm text-white/80">We will email you a link to choose a new one</p>
        </div>
        <div className="card p-6 shadow-xl">
          <ForgotForm />
          <p className="mt-4 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></p>
        </div>
      </div>
    </main>
  );
}
