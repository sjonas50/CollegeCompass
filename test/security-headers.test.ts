import { describe, expect, it } from "vitest";
import nextConfig, { securityHeaders } from "../next.config";

const asMap = (headers: { key: string; value: string }[]) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe("security headers (next.config.ts)", () => {
  it("applies to every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    expect(rules[0].headers).toEqual(securityHeaders());
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the baseline headers in every environment", () => {
    for (const env of ["development", "test", "production"] as const) {
      const h = asMap(securityHeaders(env));
      expect(h["X-Content-Type-Options"]).toBe("nosniff");
      expect(h["X-Frame-Options"]).toBe("DENY");
      expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
      const policy = h["Permissions-Policy"].split(/,\s*/);
      expect(policy).toEqual(expect.arrayContaining(["camera=()", "microphone=()", "geolocation=()"]));
    }
  });

  it("adds HSTS only in production", () => {
    expect(asMap(securityHeaders("production"))["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(asMap(securityHeaders("development"))).not.toHaveProperty("Strict-Transport-Security");
    expect(asMap(securityHeaders("test"))).not.toHaveProperty("Strict-Transport-Security");
  });

  it("has no Content-Security-Policy yet (it would break Next's inline scripts; see README)", () => {
    expect(asMap(securityHeaders("production"))).not.toHaveProperty("Content-Security-Policy");
  });
});
