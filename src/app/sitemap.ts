import { MetadataRoute } from "next";
import { locales } from "@/lib/i18n/config";
import { siteConfig } from "@/config/site";
import { blogSource } from "@/lib/source";

const STATIC_ROUTES: Array<{
  route: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
  lastModified?: Date;
}> = [
  { route: "", changeFrequency: "weekly", priority: 1 },
  { route: "blog", changeFrequency: "weekly", priority: 0.8 },
  {
    route: "roadmap",
    changeFrequency: "monthly",
    priority: 0.6,
    lastModified: new Date("2026-07-01"),
  },
  {
    route: "about",
    changeFrequency: "monthly",
    priority: 0.5,
    lastModified: new Date("2026-06-01"),
  },
  {
    route: "privacy",
    changeFrequency: "yearly",
    priority: 0.3,
    lastModified: new Date("2026-02-01"),
  },
  {
    route: "terms",
    changeFrequency: "yearly",
    priority: 0.3,
    lastModified: new Date("2026-02-01"),
  },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = siteConfig.url;
  const allPosts = blogSource.getPages();

  // Compute latest post date per locale so home & blog listing reflect real content updates
  const latestByLocale = new Map<string, Date>();
  for (const post of allPosts) {
    if (!Array.isArray(post.slugs) || post.slugs.length < 2) continue;
    const locale = post.slugs[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = post.data as any;
    const rawDate = data?.updated ?? data?.date;
    if (!rawDate) continue;
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) continue;
    const prev = latestByLocale.get(locale);
    if (!prev || parsed > prev) {
      latestByLocale.set(locale, parsed);
    }
  }

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.flatMap(
    ({ route, changeFrequency, priority, lastModified }) =>
      locales.map((locale) => ({
        url: `${baseUrl}/${locale}${route ? `/${route}` : ""}`,
        lastModified:
          lastModified ?? latestByLocale.get(locale) ?? new Date("2026-07-03"),
        changeFrequency,
        priority,
      })),
  );

  const blogEntries: MetadataRoute.Sitemap = allPosts
    .filter((post) => Array.isArray(post.slugs) && post.slugs.length >= 2)
    .map((post) => {
      const [locale, ...slugParts] = post.slugs;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = post.data as any;
      const rawDate = data?.updated ?? data?.date;
      const parsed = rawDate ? new Date(rawDate) : null;
      const lastModified =
        parsed && !Number.isNaN(parsed.getTime())
          ? parsed
          : new Date("2026-06-01");

      return {
        url: `${baseUrl}/${locale}/blog/${slugParts.join("/")}`,
        lastModified,
        changeFrequency: "monthly" as const,
        priority: 0.7,
      };
    });

  return [...staticEntries, ...blogEntries];
}
