import type { MetadataRoute } from "next";
import { sortedPosts } from "@/content/blog";
import { siteUrl } from "@/lib/site-url";

/** The public pages, for search engines. Everything behind sign-in is left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages: [string, number][] = [
    ["", 1], ["/pricing", 0.9], ["/demo", 0.8], ["/signup", 0.8], ["/about", 0.6], ["/security", 0.7], ["/trust", 0.7], ["/baa", 0.6],
    ["/contact", 0.6], ["/blog", 0.7], ["/changelog", 0.5], ["/status", 0.4], ["/accessibility", 0.3], ["/privacy", 0.3], ["/terms", 0.3], ["/gdpr", 0.2],
  ];
  return [
    ...pages.map(([path, priority]) => ({ url: `${base}${path}`, changeFrequency: "weekly" as const, priority })),
    ...sortedPosts().map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: new Date(`${p.date}T12:00:00Z`), changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
