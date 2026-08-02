import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOT standalone — next start works with Bun, standalone server.js crashes
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  productionBrowserSourceMaps: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
