import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { siteUrl } from "@/lib/site-url";

const DESCRIPTION = "Medical billing and revenue cycle management for US practices and billing companies: eligibility, clean claims, remittance posting, denials and appeals, and patient payments.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "CollaboratMD", template: "%s · CollaboratMD" },
  description: DESCRIPTION,
  applicationName: "CollaboratMD",
  openGraph: { type: "website", siteName: "CollaboratMD", locale: "en_US", title: "CollaboratMD", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "CollaboratMD", description: DESCRIPTION },
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: "CollaboratMD", statusBarStyle: "default" },
  icons: { apple: "/pwa-icon/180" },
};

export const viewport: Viewport = { themeColor: "#15803d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
