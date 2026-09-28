import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/** Search engines may read the public site; the app, patient links and the API are off limits. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/claims", "/patients", "/settings", "/ops", "/portal/", "/check-in/", "/book/", "/reset", "/print/", "/login/", "/switch", "/unsubscribe", "/welcome", "/investors"],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
