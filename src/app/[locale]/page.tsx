import { SupportChat } from "@/components/support/support-chat";
import { isSupportChatEnabled } from "@/lib/support/config";
import { Hero } from "@/components/home/hero";
import { TrustBanner } from "@/components/home/trust-banner";
import { HowItWorks } from "@/components/home/how-it-works";
import { Benefits } from "@/components/home/benefits";
import { FaqSection } from "@/components/home/faq";
import { Pricing } from "@/components/home/pricing";
import { DeploymentWidget } from "@/components/home/deployment-widget";
import { XPostEmbed } from "@/components/home/x-post-embed";
import { PageViewTracker } from "@/components/analytics/page-view-tracker";
import {
  fetchPublicHermesAgentVersion,
  fetchPublicOpenClawVersion,
} from "@/lib/openclaw/releases";
import { getCachedLandingPresetModels } from "@/lib/billing/cached-preset-models";

export const dynamic = "force-dynamic";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [latestOpenClawVersion, latestHermesAgentVersion, presetModels] =
    await Promise.all([
      fetchPublicOpenClawVersion(),
      fetchPublicHermesAgentVersion(),
      getCachedLandingPresetModels(),
    ]);

  return (
    <div className="page-shell surface-stack min-h-screen overflow-x-clip">
      <PageViewTracker locale={locale} />
      {isSupportChatEnabled() && <SupportChat locale={locale} />}
      {/* Hero Section - Client Component (Animation) */}
      <Hero
        locale={locale}
        latestOpenClawVersion={latestOpenClawVersion}
        latestHermesAgentVersion={latestHermesAgentVersion}
      />

      {/* Trust Banner - Quick trust signals */}
      <TrustBanner />

      {/* How It Works - 3-step visual flow */}
      <HowItWorks />

      {/* Social Proof - Validating the promise */}
      <XPostEmbed />

      {/* Benefits - Pain points → Solutions */}
      <Benefits />

      {/* Deployment Widget - Client Component (Complex State) */}
      <DeploymentWidget locale={locale} initialModels={presetModels} />

      {/* Pricing Section - Static Content */}
      <Pricing locale={locale} />

      {/* FAQ Section */}
      <FaqSection />
    </div>
  );
}
