import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
      },
      {
        protocol: "https",
        hostname: "images-na.ssl-images-amazon.com",
      },
      {
        protocol: "https",
        hostname: "images.example.com",
      },
      {
        protocol: "https",
        hostname: "v3b.fal.media",
      },
    ],
  },
};

export default nextConfig;
