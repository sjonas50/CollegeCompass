import type { NextConfig } from "next";

// Sent on every response. There is no Content-Security-Policy yet: a strict one needs per-request
// nonces for Next's inline scripts, which would make every page dynamic, so it is a documented
// follow-up (README, "Security headers"). X-Frame-Options covers clickjacking meanwhile.
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No camera, microphone or location, and no ad-interest tracking (Topics API; interest-cohort
  // was its retired predecessor, which browsers now warn about).
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

// Production only: browsers remember HSTS for two years, so a local HTTPS dev server must never
// send it for localhost. "preload" only matters after submitting the domain at hstspreload.org,
// which commits every subdomain to HTTPS; don't submit without checking them all.
const hsts = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" };

export function securityHeaders(nodeEnv = process.env.NODE_ENV) {
  return nodeEnv === "production" ? [...baseHeaders, hsts] : baseHeaders;
}

const nextConfig: NextConfig = {
  // Native/WASM packages that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@node-rs/argon2"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
