import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/mailer";
import { db } from "@/lib/db";
import { deploymentAgentJobs, installSessions, user } from "@/lib/db/schema";
import { enqueueAgentJob, isAgentJobInProgress } from "@/lib/deploy/agent-jobs";
import { openSessionSecret } from "@/lib/deploy/session-secrets";
import {
  fetchLatestHermesAgentVersion,
  getClawSimpleBaseUrl,
} from "@/lib/openclaw/releases";
import { isHermesAgentVersionMatch } from "@/lib/openclaw/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_JOB_STALE_MINUTES = 30;

function readFingerprint(serverFingerprint: unknown) {
  if (!serverFingerprint || typeof serverFingerprint !== "object") return {};
  return serverFingerprint as Record<string, unknown>;
}

function parseIsoDate(input: unknown) {
  if (typeof input !== "string" || input.trim().length === 0) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMinutes(envName: string, fallback: number) {
  const parsed = Number.parseInt((process.env[envName] ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isOlderThanMinutes(input: unknown, minutes: number, now = new Date()) {
  const date = input instanceof Date ? input : parseIsoDate(input);
  if (!date) return false;
  return now.getTime() - date.getTime() > minutes * 60_000;
}

function decryptBotToken(value: string | null | undefined) {
  if (!value) return "";
  try {
    return openSessionSecret(value).trim();
  } catch {
    return "";
  }
}

async function validateTelegramGetMe(botToken: string) {
  if (!botToken) return { ok: false, details: "bot token missing" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, details: `getMe HTTP ${response.status}: ${body.slice(0, 160)}` };
    }
    const payload = (await response.json()) as { ok?: boolean; description?: unknown };
    return payload.ok
      ? { ok: true, details: "ok" }
      : {
          ok: false,
          details: typeof payload.description === "string" ? payload.description : "getMe failed",
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return { ok: false, details: `getMe request failed: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveNotificationRecipients() {
  const envList = (process.env.HERMES_RELEASE_NOTIFY_EMAIL ?? "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (envList.length > 0) return Array.from(new Set(envList));

  const adminRows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, "admin"));
  return Array.from(new Set(adminRows.map((row) => row.email?.trim() ?? "").filter(Boolean)));
}

async function notifyFailure(params: {
  stage: string;
  details: string;
  version: string | null;
  deploymentName: string;
  sid: string;
}) {
  const recipients = await resolveNotificationRecipients();
  if (recipients.length === 0) return { ok: false, status: "recipient_missing" as const };
  const adminUrl = `${getClawSimpleBaseUrl().replace(/\/+$/, "")}/en/admin/deployments`;
  const subject = `Hermes release check failed: ${params.stage}`;
  const text = [
    "Hermes release check failed.",
    `Stage: ${params.stage}`,
    `Version: ${params.version ?? "unknown"}`,
    `Deployment: ${params.deploymentName} (${params.sid})`,
    `Details: ${params.details}`,
    `Admin: ${adminUrl}`,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;"><h2>Hermes release check failed</h2><p>${text.replace(/\n/g, "<br>")}</p></div>`;
  for (const recipient of recipients) {
    await sendEmail({ to: recipient, subject, html, text });
  }
  return { ok: true, status: "sent" as const, recipients };
}

function readHermesVersion(serverFingerprint: unknown) {
  const fingerprint = readFingerprint(serverFingerprint);
  const version = fingerprint.hermes_agent_version;
  return typeof version === "string" ? version : null;
}

async function updateServerFingerprint(sid: string, patch: Record<string, unknown>) {
  const rows = await db
    .select({ serverFingerprint: installSessions.serverFingerprint })
    .from(installSessions)
    .where(eq(installSessions.id, sid))
    .limit(1);
  const current = readFingerprint(rows[0]?.serverFingerprint);
  await db
    .update(installSessions)
    .set({ serverFingerprint: { ...current, ...patch } })
    .where(eq(installSessions.id, sid));
}

async function findRecentHermesUpgradeJobs(sid: string) {
  return db
    .select({
      id: deploymentAgentJobs.id,
      jobType: deploymentAgentJobs.jobType,
      status: deploymentAgentJobs.status,
      payload: deploymentAgentJobs.payload,
      errorMessage: deploymentAgentJobs.errorMessage,
      createdAt: deploymentAgentJobs.createdAt,
    })
    .from(deploymentAgentJobs)
    .where(and(eq(deploymentAgentJobs.sid, sid), eq(deploymentAgentJobs.jobType, "hermes_upgrade")))
    .orderBy(desc(deploymentAgentJobs.createdAt))
    .limit(10);
}

function readJobVersion(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const version = (payload as Record<string, unknown>).version;
  return typeof version === "string" ? version.trim() : "";
}

function findJobIssue(
  jobs: Awaited<ReturnType<typeof findRecentHermesUpgradeJobs>>,
  version: string,
  now: Date,
  staleMinutes: number
) {
  for (const job of jobs) {
    if (!isHermesAgentVersionMatch(readJobVersion(job.payload), version)) continue;
    if (job.status === "failed") {
      return {
        job,
        status: "failed" as const,
        details: job.errorMessage?.trim() || `Hermes upgrade job ${job.id} failed`,
      };
    }
    if (
      ["pending", "running"].includes(job.status) &&
      isOlderThanMinutes(job.createdAt, staleMinutes, now)
    ) {
      return {
        job,
        status: "stuck" as const,
        details: `Hermes upgrade job ${job.id} is ${job.status} for more than ${staleMinutes} minutes`,
      };
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  if (!cronSecret) {
    return NextResponse.json({ ok: false, error: "cron_secret_missing" }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const testEmail =
    (process.env.HERMES_RELEASE_TEST_EMAIL ?? "").trim() ||
    (process.env.OPENCLAW_RELEASE_TEST_EMAIL ?? "").trim() ||
    (process.env.DEPLOY_TEST_EMAIL ?? "").trim();
  if (!testEmail) {
    return NextResponse.json(
      {
        ok: false,
        error: "test_email_missing",
        details:
          "HERMES_RELEASE_TEST_EMAIL, OPENCLAW_RELEASE_TEST_EMAIL, or DEPLOY_TEST_EMAIL must be configured before enabling hermes-release-check.",
      },
      { status: 503 }
    );
  }

  const latestVersion = await fetchLatestHermesAgentVersion({ force: true });
  const sessions = await db
    .select({
      sid: installSessions.id,
      userId: installSessions.userId,
      displayName: installSessions.displayName,
      tgTokenCiphertext: installSessions.tgTokenCiphertext,
      serverFingerprint: installSessions.serverFingerprint,
    })
    .from(installSessions)
    .innerJoin(user, eq(installSessions.userId, user.id))
    .where(and(eq(user.email, testEmail), eq(installSessions.active, true), eq(installSessions.status, "completed")))
    .orderBy(desc(installSessions.createdAt));

  const target = sessions[0];
  if (!target || !target.userId) {
    return NextResponse.json(
      { ok: false, error: "test_deployment_not_found", latest_hermes_agent_version: latestVersion },
      { status: 404 }
    );
  }

  const fingerprint = readFingerprint(target.serverFingerprint);
  const currentVersion = readHermesVersion(target.serverFingerprint);
  const recentJobs = await findRecentHermesUpgradeJobs(target.sid);
  const now = new Date();
  const jobStaleMinutes = getMinutes("HERMES_RELEASE_JOB_STALE_MINUTES", DEFAULT_JOB_STALE_MINUTES);

  if (!isHermesAgentVersionMatch(currentVersion, latestVersion)) {
    const blockedVersion =
      typeof fingerprint.hermes_release_blocked_version === "string"
        ? fingerprint.hermes_release_blocked_version
        : "";
    if (isHermesAgentVersionMatch(blockedVersion, latestVersion)) {
      return NextResponse.json({
        ok: true,
        action: "upgrade_blocked",
        sid: target.sid,
        latest_hermes_agent_version: latestVersion,
        current_hermes_agent_version: currentVersion,
      });
    }

    const issue = findJobIssue(recentJobs, latestVersion, now, jobStaleMinutes);
    if (issue) {
      const checkedAt = now.toISOString();
      const details = issue.details;
      const failureNotification = await notifyFailure({
        stage: `upgrade_${issue.status}`,
        details,
        version: latestVersion,
        deploymentName: target.displayName?.trim() || target.sid,
        sid: target.sid,
      });
      await updateServerFingerprint(target.sid, {
        hermes_release_validation_checked_at: checkedAt,
        hermes_release_validation_error: details,
        hermes_release_tested_version: latestVersion,
        hermes_release_blocked_version: latestVersion,
        hermes_release_upgrade_job_id: issue.job.id,
        hermes_release_upgrade_status: issue.status,
      });
      return NextResponse.json(
        {
          ok: false,
          action: `upgrade_${issue.status}`,
          sid: target.sid,
          latest_hermes_agent_version: latestVersion,
          details,
          failure_notification: failureNotification,
        },
        { status: 409 }
      );
    }

    const pendingJobs = await db
      .select({
        id: deploymentAgentJobs.id,
        jobType: deploymentAgentJobs.jobType,
        status: deploymentAgentJobs.status,
        createdAt: deploymentAgentJobs.createdAt,
        startedAt: deploymentAgentJobs.startedAt,
      })
      .from(deploymentAgentJobs)
      .where(and(eq(deploymentAgentJobs.sid, target.sid), inArray(deploymentAgentJobs.status, ["pending", "running"])));
    const inProgress = pendingJobs.find((job) => isAgentJobInProgress(job));
    if (inProgress) {
      return NextResponse.json({
        ok: true,
        action: "waiting_for_upgrade",
        sid: target.sid,
        latest_hermes_agent_version: latestVersion,
        job_id: inProgress.id,
        job_status: inProgress.status,
      });
    }

    const jobId = crypto.randomUUID();
    const createdAt = await enqueueAgentJob({
      id: jobId,
      sid: target.sid,
      userId: target.userId,
      jobType: "hermes_upgrade",
      payload: { version: latestVersion },
    });
    await updateServerFingerprint(target.sid, {
      hermes_release_validation_checked_at: createdAt.toISOString(),
      hermes_release_validation_error: null,
      hermes_release_tested_version: latestVersion,
      hermes_release_blocked_version: null,
      hermes_release_upgrade_job_id: jobId,
      hermes_release_upgrade_status: "pending",
    });
    return NextResponse.json({
      ok: true,
      action: "upgrade_enqueued",
      sid: target.sid,
      latest_hermes_agent_version: latestVersion,
      current_hermes_agent_version: currentVersion,
      job_id: jobId,
      created_at: createdAt.toISOString(),
    });
  }

  const validationErrors: string[] = [];
  const mainRuntime =
    fingerprint.agent_runtimes &&
    typeof fingerprint.agent_runtimes === "object" &&
    !Array.isArray(fingerprint.agent_runtimes)
      ? (fingerprint.agent_runtimes as Record<string, Record<string, unknown>>).main
      : null;
  if (mainRuntime?.active_runtime !== "hermes") {
    validationErrors.push("main agent is not running Hermes");
  }
  if (mainRuntime?.hermes_service_state !== "active") {
    validationErrors.push("Hermes service is not active");
  }
  const getMe = await validateTelegramGetMe(decryptBotToken(target.tgTokenCiphertext));
  if (!getMe.ok) validationErrors.push(getMe.details);

  const checkedAt = now.toISOString();
  if (validationErrors.length > 0) {
    const details = validationErrors.join("; ");
    const failureNotification = await notifyFailure({
      stage: "validation",
      details,
      version: latestVersion,
      deploymentName: target.displayName?.trim() || target.sid,
      sid: target.sid,
    });
    await updateServerFingerprint(target.sid, {
      hermes_release_validation_checked_at: checkedAt,
      hermes_release_validation_error: details,
      hermes_release_tested_version: latestVersion,
      hermes_release_blocked_version: latestVersion,
    });
    return NextResponse.json(
      {
        ok: false,
        action: "validation_failed",
        sid: target.sid,
        latest_hermes_agent_version: latestVersion,
        details,
        failure_notification: failureNotification,
      },
      { status: 409 }
    );
  }

  const lastNotifiedVersion =
    typeof fingerprint.hermes_release_notified_version === "string"
      ? fingerprint.hermes_release_notified_version
      : "";
  if (!isHermesAgentVersionMatch(lastNotifiedVersion, latestVersion)) {
    const recipients = await resolveNotificationRecipients();
    if (recipients.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "notification_recipient_missing",
          details:
            "Configure HERMES_RELEASE_NOTIFY_EMAIL or ensure at least one admin account has an email.",
        },
        { status: 500 }
      );
    }
    const adminUrl = `${getClawSimpleBaseUrl().replace(/\/+$/, "")}/en/admin/deployments`;
    const subject = `Hermes ${latestVersion} is ready for rollout`;
    const text = [
      `Hermes ${latestVersion} passed test deployment validation.`,
      `Deployment: ${target.displayName?.trim() || target.sid} (${target.sid})`,
      `Admin: ${adminUrl}`,
    ].join("\n");
    const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18181b;"><h2>Hermes ${latestVersion} passed validation</h2><p>${text.replace(/\n/g, "<br>")}</p></div>`;
    for (const recipient of recipients) {
      await sendEmail({ to: recipient, subject, html, text });
    }
  }

  await updateServerFingerprint(target.sid, {
    hermes_release_validation_checked_at: checkedAt,
    hermes_release_validation_error: null,
    hermes_release_tested_version: latestVersion,
    hermes_release_notified_version: latestVersion,
    hermes_release_notified_at: checkedAt,
    hermes_release_blocked_version: null,
  });

  return NextResponse.json({
    ok: true,
    action: isHermesAgentVersionMatch(lastNotifiedVersion, latestVersion)
      ? "already_notified"
      : "notified",
    sid: target.sid,
    latest_hermes_agent_version: latestVersion,
    current_hermes_agent_version: currentVersion,
  });
}
