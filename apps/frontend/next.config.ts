import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    // Changes every build, so each deploy registers the service worker at a new
    // address that no CDN has cached.
    NEXT_PUBLIC_BUILD_ID: (process.env.GITHUB_SHA || Date.now().toString(36)).slice(0, 12),
  },
};

export default nextConfig;
