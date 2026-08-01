import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable Turbopack for production builds — use webpack instead
  // Turbopack needs worker_threads features that Bun doesn't support
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  // Reduce build memory
  productionBrowserSourceMaps: false,
};

export default nextConfig;
