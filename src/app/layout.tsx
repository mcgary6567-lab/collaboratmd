import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CollaboratMD",
  description: "Cloud medical billing and revenue cycle management",
};

// Runs before first paint so a dark-mode user never sees a white flash, and
// keeps public pages static (no cookie read on the server). The theme only
// styles the signed-in app (.app-shell), not the public site.
const THEME_SCRIPT = `document.documentElement.dataset.theme=/(?:^|; )cmd_theme=dark/.test(document.cookie)?"dark":"light"`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
