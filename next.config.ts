import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
  // Minimize build memory:
  // - Disable Turbopack (needs worker_threads, Bun doesn't support)
  // - Disable worker threads (use single-threaded build)
  // - Disable source maps (less memory)
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  productionBrowserSourceMaps: false,
  // Don't optimize images at build time (sharp is heavy)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
