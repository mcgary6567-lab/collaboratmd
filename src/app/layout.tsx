import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedBill RCM",
  description: "Cloud medical billing and revenue cycle management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
