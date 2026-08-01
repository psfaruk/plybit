import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable Turbopack for production builds — it needs worker_threads
  // features that Bun doesn't fully support. Webpack works everywhere.
  // Turbopack is still used in `next dev` (faster dev experience).
  experimental: {
    // Limit memory usage during build (important for Railway's 512MB-1GB)
    workerThreads: false,
    cpus: 1,
  },
  // Reduce build memory by disabling some optimizations
  productionBrowserSourceMaps: false,
};

export default nextConfig;
