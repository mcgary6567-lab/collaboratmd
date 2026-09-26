import type { MetadataRoute } from "next";

/** Lets the app be installed on phones and desktops (Add to Home Screen / Install). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CollaboratMD",
    short_name: "CollaboratMD",
    description: "Medical billing and revenue cycle management",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#15803d",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My work", url: "/dashboard" },
      { name: "Notifications", url: "/notifications" },
      { name: "Check-ins", url: "/check-ins" },
    ],
  };
}
