import { LogoMark } from "@/components/logo";

/** Shown by the service worker when the app is opened without a connection. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
      <div>
        <LogoMark className="mx-auto mb-4 h-12 w-12" id="cmd-offline" />
        <h1 className="text-xl font-bold text-slate-900">You are offline</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-600">CollaboratMD needs a connection: patient and billing data are never stored on this device. Reconnect and try again.</p>
      </div>
    </main>
  );
}
