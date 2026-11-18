import type { NextConfig } from "next";
import { writeFileSync } from "fs";
import { join } from "path";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Changes every build, so each deploy registers the service worker at a new
// address that no CDN has cached - and open pages can tell a newer release is
// out (they compare it with /version.json, written here into the site).
const buildId = (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12);
try {
  writeFileSync(join(__dirname, "public", "version.json"), JSON.stringify({ release: buildId }) + "\n");
} catch {
  // A read-only checkout: the update notice simply never shows.
}

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;
