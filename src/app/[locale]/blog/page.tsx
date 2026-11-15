import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { siteConfig } from "@/config/site";
import { constructMetadata } from "@/lib/seo";
import { blogSource } from "@/lib/source";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "blog.listing" });

  return constructMetadata({
    title: `${t("title")} - ${siteConfig.name}`,
    description: t("description"),
    locale,
    path: "/blog",
  });
}

export default async function BlogListingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "blog.listing" });
  const allPosts = blogSource.getPages();

  // Filter to posts whose content locale matches the current URL locale,
  // then sort by date descending.
  // Slug format is [contentLocale, ...filename], e.g. ["en", "hermes-guide"]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = allPosts.filter((post: any) => {
    const slugs = post.slugs;
    return Array.isArray(slugs) && slugs[0] === locale;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...filtered].sort((a: any, b: any) => {
    const dateA = a.data?.date ? new Date(a.data.date).getTime() : 0;
    const dateB = b.data?.date ? new Date(b.data.date).getTime() : 0;
    return dateB - dateA;
  });

  return (
    <div className="page-shell surface-stack min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <header className="mb-12">
          <h1 className="text-4xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            {t("description")}
          </p>
        </header>

        {sorted.length === 0 ? (
          <p className="text-muted-foreground">No posts yet.</p>
        ) : (
          <div className="space-y-10">
            {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              sorted.map((post: any) => {
                const data = post.data;
                const title = data?.title ?? post.slugs?.join("/");
                const description = data?.description ?? "";
                const date = data?.date ? new Date(data.date) : null;
                const href = `/${locale}/blog/${post.slugs.slice(1).join("/")}`;

                return (
                  <article key={post.url ?? post.slugs?.join("/")}>
                    <Link href={href} className="group block">
                      <h2 className="text-xl font-semibold tracking-tight group-hover:text-primary transition-colors">
                        {title}
                      </h2>
                      {date && (
                        <time
                          dateTime={date.toISOString()}
                          className="mt-1 block text-sm text-muted-foreground"
                        >
                          {date.toLocaleDateString(locale, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })}
                        </time>
                      )}
                      {description && (
                        <p className="mt-2 text-muted-foreground line-clamp-2">
                          {description}
                        </p>
                      )}
                      <span className="mt-3 inline-flex text-sm font-medium text-primary group-hover:underline">
                        {t("readMore")} &rarr;
                      </span>
                    </Link>
                  </article>
                );
              })
            }
          </div>
        )}
      </div>
    </div>
  );
}
