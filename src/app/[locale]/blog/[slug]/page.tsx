import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { siteConfig } from "@/config/site";
import { constructMetadata } from "@/lib/seo";
import { blogSource } from "@/lib/source";
import { BlogCTA } from "@/components/blog/blog-cta";
import { locales } from "@/lib/i18n/config";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
};

export async function generateStaticParams() {
  const params = blogSource.generateParams();
  // Each slug is e.g. ["en", "agent-deployment-strategies"] — the first segment
  // is the content locale, the rest is the filename stem.
  // We only generate routes where the URL locale matches the content locale.
  return params
    .filter((p) => Array.isArray(p.slug) && p.slug.length >= 2)
    .map((p) => {
      const slugs = p.slug as string[];
      return {
        locale: slugs[0],
        slug: slugs.slice(1).join("/"),
      };
    });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  // Reconstruct the locale-prefixed path that fumadocs uses internally
  const page = blogSource.getPage([locale, slug]);
  if (!page) return {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = page.data as any;
  const title = data?.title ?? slug;
  const description = data?.description ?? "";

  const availableLocales = locales.filter((l) =>
    Boolean(blogSource.getPage([l, slug])),
  );
  const languages: Record<string, string> = Object.fromEntries(
    availableLocales.map((l) => [l, `${siteConfig.url}/${l}/blog/${slug}`]),
  );
  if (availableLocales.includes("en")) {
    languages["x-default"] = `${siteConfig.url}/en/blog/${slug}`;
  } else if (availableLocales[0]) {
    languages["x-default"] =
      `${siteConfig.url}/${availableLocales[0]}/blog/${slug}`;
  }

  const baseMeta = constructMetadata({
    title,
    description,
    locale,
    path: `/blog/${slug}`,
    ...(data?.image ? { image: data.image } : {}),
  });

  return {
    ...baseMeta,
    openGraph: {
      ...baseMeta.openGraph,
      type: "article",
    },
    alternates: {
      canonical: `${siteConfig.url}/${locale}/blog/${slug}`,
      languages,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const page = blogSource.getPage([locale, slug]);
  if (!page) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = page.data as any;
  const title = data?.title ?? slug;
  const date = data?.date ? new Date(data.date) : null;

  const MDX = data.body;
  const t = await getTranslations({ locale, namespace: "blog.post" });

  return (
    <div className="page-shell surface-stack min-h-screen">
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Link
          href={`/${locale}/blog`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          &larr; {t("backToList")}
        </Link>

        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {date && (
            <time
              dateTime={date.toISOString()}
              className="mt-3 block text-sm text-muted-foreground"
            >
              {date.toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          )}
        </header>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <MDX />
        </div>

        <BlogCTA />
      </article>
    </div>
  );
}
