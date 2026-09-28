import { configuredOrigin } from "./configured-origin";

/** The public address used in links that leave the site (sitemap, shared previews). */
export const siteUrl = () => configuredOrigin() ?? "https://collaboratmd.vercel.app";
