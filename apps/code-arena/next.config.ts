import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CODE_ARENA_DIST_DIR ?? '.next',
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
