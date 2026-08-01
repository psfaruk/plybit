import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOT standalone — we use `next start` instead (works with bun runtime)
  // standalone needs node binary which Nixpacks doesn't provide at runtime
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
