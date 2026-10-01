import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/env";

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.appUrl || "http://localhost:3000";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/api", "/track", "/onboarding"] }], sitemap: `${base}/sitemap.xml` };
}
