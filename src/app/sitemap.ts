import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicEnv.appUrl || "http://localhost:3000";
  return ["", "/features", "/pricing", "/how-it-works", "/faq", "/contact", "/login", "/signup"].map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly", priority: p === "" ? 1 : 0.7 }));
}
