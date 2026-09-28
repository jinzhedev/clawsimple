import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { createMDX } from "fumadocs-mdx/next";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");
const withMDX = createMDX();

const isProd = process.env.NODE_ENV === "production";
const isCspReportOnly =
  process.env.CSP_REPORT_ONLY === "1" || process.env.CSP_REPORT_ONLY === "true";

function getOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function uniqueValues(values: Array<string | null | false | undefined>) {
  return Array.from(new Set(values.filter(Boolean))) as string[];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
  compiler: isProd
    ? {
        // Remove console.* in production bundles to reduce noise and accidental data exposure.
        removeConsole: { exclude: ["error", "warn"] },
      }
    : undefined,
  async headers() {
    const umamiOrigin = getOrigin(process.env.NEXT_PUBLIC_UMAMI_SCRIPT);
    const datafastOrigin = process.env.NEXT_PUBLIC_DATAFAST_WEBSITE_ID
      ? "https://datafa.st"
      : null;
    const analyticsScriptSrc = uniqueValues([umamiOrigin, datafastOrigin]);
    const analyticsConnectSrc = uniqueValues([umamiOrigin, datafastOrigin]);
    const analyticsImgSrc = uniqueValues([umamiOrigin]);

    const csp = [
      "default-src 'self'",
      // Keep 'unsafe-inline' for now; remove 'unsafe-eval' in production.
      `script-src 'self'${isProd ? "" : " 'unsafe-eval'"} 'unsafe-inline' https://js.stripe.com https://va.vercel-scripts.com ${analyticsScriptSrc.join(" ")} https://static.cloudflareinsights.com https://www.googletagmanager.com https://www.youtube.com https://widget.trustpilot.com https://platform.twitter.com`,
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' blob: data: https://*.stripe.com https://*.googleusercontent.com ${analyticsImgSrc.join(" ")} https://www.google.com https://www.google.co.jp https://www.googleadservices.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://www.google-analytics.com https://api.producthunt.com https://i.ytimg.com https://*.ytimg.com https://aijustbetter.com https://hicyou.com https://pbs.twimg.com https://video.twimg.com`,
      "font-src 'self'",
      `connect-src 'self' https://api.stripe.com ${analyticsConnectSrc.join(" ")} https://cloudflareinsights.com https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://pagead2.googlesyndication.com https://widget.trustpilot.com https://syndication.twitter.com https://cdn.syndication.twimg.com`,
      // Allow YouTube embeds (iframes) across the site.
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.youtube.com https://www.youtube-nocookie.com https://widget.trustpilot.com https://platform.twitter.com https://syndication.twitter.com",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
          {
            // Set `CSP_REPORT_ONLY=true` (or `1`) to observe violations without blocking.
            key: isCspReportOnly
              ? "Content-Security-Policy-Report-Only"
              : "Content-Security-Policy",
            value: csp,
          },
        ],
      },
    ];
  },
};

export default withMDX(withNextIntl(nextConfig));
