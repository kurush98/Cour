import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The ingestion layer must never be reachable from a request path
  // (MAL agreement: user reads always serve from our own database).
  // Enforced by tests/architecture.test.ts; this is the belt to that braces.
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
