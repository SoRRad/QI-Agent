import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone output keeps the self-hosted image small and free of a
  // Vercel-specific runtime. See docs/DEPLOY.md.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint runs as its own step in `pnpm verify`; don't duplicate it in build.
    ignoreDuringBuilds: true,
  },
};

export default config;
