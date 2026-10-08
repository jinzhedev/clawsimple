"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { siteConfig } from "@/config/site";
import { DiscordLink } from "./discord-link";

export function Footer() {
  const t = useTranslations();
  const locale = useLocale() as string;

  return (
    <footer className="border-t border-[#e7ddd2] bg-[#f6f2ec] dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-6 py-12 md:px-10">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          <div className="col-span-2">
            <Link href={`/${locale}`} className="flex items-center gap-2">
              <Image
                src="/brand/clawsimple.svg"
                alt="ClawSimple logo"
                width={32}
                height={32}
                className="h-8 w-8"
              />
              <span className="text-lg font-semibold text-[#171512] dark:text-zinc-50">
                ClawSimple
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-[#5c534c] dark:text-zinc-400">
              {t("footer.tagline")}
            </p>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-[#171512] dark:text-zinc-50">
              {t("footer.product")}
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={`/${locale}#overview`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("common.overview")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}#pricing`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("common.pricing")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/roadmap`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("common.roadmap")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/blog`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("common.blog")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-[#171512] dark:text-zinc-50">
              {t("footer.company")}
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  href={`/${locale}/about`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("footer.about")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/privacy`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("footer.privacy")}
                </Link>
              </li>
              <li>
                <Link
                  href={`/${locale}/terms`}
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  {t("footer.terms")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 text-sm font-semibold text-[#171512] dark:text-zinc-50">
              Community
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={siteConfig.links.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  Twitter
                </a>
              </li>
              <li>
                <a
                  href={siteConfig.links.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50"
                >
                  GitHub
                </a>
              </li>
              <li>
                <DiscordLink className="text-[#5c534c] transition-colors hover:text-[#171512] dark:text-zinc-400 dark:hover:text-zinc-50" />
              </li>
            </ul>
          </div>
        </div>

        <Separator className="my-8 bg-[#e7ddd2] dark:bg-zinc-800" />

        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-[#5c534c] dark:text-zinc-400">
            © {new Date().getFullYear()} ClawSimple. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
