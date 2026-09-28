import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { MicrosoftClarity } from "@/components/analytics/microsoft-clarity";
import { GoogleAdsTag } from "@/components/analytics/google-ads-tag";
import { locales, type Locale } from "@/lib/i18n/config";
import { OrganizationJsonLd } from "@/components/seo/organization-json-ld";
import { Toaster } from "@/components/ui/toaster";
import { readPublicEnv } from "@/lib/env";
import "../globals.css";

const display = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400"],
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

import { constructMetadata } from "@/lib/seo";

const umamiWebsiteId = readPublicEnv(process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID);
const umamiScript = readPublicEnv(process.env.NEXT_PUBLIC_UMAMI_SCRIPT);
const datafastWebsiteId = readPublicEnv(
  process.env.NEXT_PUBLIC_DATAFAST_WEBSITE_ID,
);
const datafastDomain = readPublicEnv(process.env.NEXT_PUBLIC_DATAFAST_DOMAIN);

export async function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const metadata = constructMetadata({
    title: "ClawSimple - Managed OpenClaw Hosting for Telegram Bots",
    description:
      "Managed OpenClaw and Hermes Agent hosting for Telegram bots with platform AI, managed search, and server maintenance.",
    locale,
    path: "/",
  });

  return {
    ...metadata,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "ClawSimple",
    },
    icons: {
      icon: [
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon.ico" },
      ],
      apple: "/apple-touch-icon.png",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Validate locale
  const isLocale = (value: string): value is Locale =>
    locales.includes(value as Locale);

  if (!isLocale(locale)) {
    notFound();
  }

  setRequestLocale(locale);

  // Providing all messages to the client side
  const messages = await getMessages({ locale });

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} antialiased`}>
        <Script id="register-sw" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function () {
                navigator.serviceWorker
                  .register('/sw.js')
                  .then(function (registration) {
                    registration.update().catch(function () {});
                  })
                  .catch(function () {});
              });
            }
          `}
        </Script>
        {umamiWebsiteId ? (
          <Script
            src={umamiScript}
            data-website-id={umamiWebsiteId}
            strategy="afterInteractive"
          />
        ) : null}
        {datafastWebsiteId ? (
          <Script
            src="https://datafa.st/js/script.js"
            data-website-id={datafastWebsiteId}
            data-domain={datafastDomain}
            strategy="afterInteractive"
          />
        ) : null}
        <GoogleAdsTag />
        <MicrosoftClarity />
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <OrganizationJsonLd />
            <div className="flex min-h-screen flex-col overflow-x-clip font-[var(--font-body)]">
              <Header />
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
