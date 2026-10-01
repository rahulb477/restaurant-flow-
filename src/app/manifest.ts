import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: publicEnv.appName,
    short_name: publicEnv.appName,
    description: "Scan, order and pay at your table.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0c0e",
    theme_color: "#0c0c0e",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
