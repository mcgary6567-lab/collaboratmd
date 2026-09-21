import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 text-2xl font-black">M</div>
          <h1 className="text-2xl font-bold">MedBill RCM</h1>
          <p className="text-sm text-white/80">Medical billing and revenue cycle management</p>
        </div>
        <div className="card p-6 shadow-xl">
          <LoginForm />
          <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="mb-1 font-semibold">Demo accounts</div>
            <div>admin@medbill.local / admin123</div>
            <div>biller@medbill.local / biller123</div>
            <div>frontdesk@medbill.local / front123</div>
          </div>
        </div>
      </div>
    </main>
  );
}
