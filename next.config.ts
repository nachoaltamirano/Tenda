import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["sharp", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "80mb" },
  },
};

export default nextConfig;
