import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `ws` is a transitive dep of @solana/kit's WebSocket client. Excluded
  // from server bundling so it isn't tree-shaken away.
  serverExternalPackages: ["ws"],

  // Allow rendering Pinata gateway images without configuring
  // remotePatterns one-by-one (we use a plain <img> tag in /job/[id]
  // because CIDs are dynamic).
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "gateway.pinata.cloud",
        pathname: "/ipfs/**",
      },
    ],
  },
};

export default nextConfig;
