import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/mailer";
import { db } from "@/lib/db";
import { deploymentAgentJobs, installSessions, user } from "@/lib/db/schema";
import { enqueueAgentJob, isAgentJobInProgress } from "@/lib/deploy/agent-jobs";
import { openSessionSecret } from "@/lib/deploy/session-secrets";
import { resolveDeploymentServiceName } from "@/lib/deploy/deployment-service-name";
import {
  fetchLatestOpenClawVersion,
  getClawSimpleBaseUrl,
} from "@/lib/openclaw/releases";
import { buildOpenClawReleaseValidationErrors } from "@/lib/openclaw/release-check-validation";
import {
  isOpenClawVersionMatch,
  normalizeOpenClawVersion,
} from "@/lib/openclaw/version";
import { locales } from "@/lib/i18n/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_UPGRADE_JOB_STALE_MINUTES = 30;

function parseIsoDate(input: unknown) {
  if (typeof input !== "string" || input.trim().length === 0) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getUpgradeJobStaleMinutes() {
  const raw = (process.env.OPENCLAW_RELEASE_JOB_STALE_MINUTES ?? "").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPGRADE_JOB_STALE_MINUTES;
}

function isOlderThanMinutes(input: unknown, minutes: number, now = new Date()) {
  const date = input instanceof Date ? input : parseIsoDate(input);
  if (!date) return false;
  return now.getTime() - date.getTime() > minutes * 60_000;
}

function readFingerprint(serverFingerprint: unknown) {
  if (!serverFingerprint || typeof serverFingerprint !== "object") {
    return {};
  }
  return serverFingerprint as Record<string, unknown>;
}

function revalidateHomeVersionPages() {
  const paths = ["/", ...locales.map((locale) => `/${locale}`)];
  const revalidated: string[] = [];
  for (const path of paths) {
    try {
      revalidatePath(path);
      revalidated.push(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      console.warn(`[openclaw-release-check] home revalidate failed path=${path} error=${message}`);
    }
  }
  return revalidated;
}

function readJobPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return payload as Record<string, unknown>;
}

function getJobVersion(payload: Record<string, unknown>) {
  return normalizeOpenClawVersion(
    typeof payload.version === "string" ? payload.version : null
  );
}

function getJobRollbackFrom(payload: Record<string, unknown>) {
  return normalizeOpenClawVersion(
    typeof payload.rollback_from === "string" ? payload.rollback_from : null
  );
}

function getJobRunnerVersion(payload: Record<string, unknown>) {
  return typeof payload.runner_version === "string"
    ? payload.runner_version.trim()
    : "";
}

function logReleaseCheck(event: string, details: Record<string, unknown>) {
  console.info("[openclaw-release-check]", {
    event,
    checked_at: new Date().toISOString(),
    ...details,
  });
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
    .set({
      serverFingerprint: {
        ...current,
        ...patch,
      },
    })
    .where(eq(installSessions.id, sid));
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
  if (!botToken) {
    return {
      ok: false,
      details: "bot token missing",
      result: null as Record<string, unknown> | null,
    };
  }

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
      return {
        ok: false,
        details: `getMe HTTP ${response.status}: ${body.slice(0, 160)}`,
        result: null,
      };
    }
    const payload = (await response.json()) as {
      ok?: boolean;
      result?: Record<string, unknown>;
      description?: unknown;
    };
    if (!payload.ok || !payload.result || typeof payload.result !== "object") {
      return {
        ok: false,
        details:
          typeof payload.description === "string"
            ? payload.description
            : "getMe returned an invalid payload",
        result: null,
      };
    }
    return {
      ok: true,
      details: "ok",
      result: payload.result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return {
      ok: false,
      details: `getMe request failed: ${message}`,
      result: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildNotificationEmail(params: {
  version: string;
  deploymentName: string;
  sid: string;
  botUsername: string | null;
}) {
  const adminUrl = `${getClawSimpleBaseUrl().replace(/\/+$/, "")}/en/admin/deployments`;
  const botLabel = params.botUsername ? `@${params.botUsername}` : "Bot getMe passed";
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #18181b;">
      <h2 style="margin: 0 0 12px;">OpenClaw ${params.version} passed test deployment validation</h2>
      <p style="margin: 0 0 12px;">
        Test deployment <strong>${params.deploymentName}</strong> (${params.sid}) was upgraded and validated successfully.
      </p>
      <ul style="margin: 0 0 16px; padding-left: 18px;">
        <li>Telegram: ${botLabel}</li>
      </ul>
      <p style="margin: 0 0 12px;">
        You can now open the admin deployments page and run the batch OpenClaw upgrade.
      </p>
      <p style="margin: 0;">
        <a href="${adminUrl}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#171512;color:#f8f5f0;text-decoration:none;">Open Admin Deployments</a>
      </p>
    </div>
  `;
  const text = [
    `OpenClaw ${params.version} passed test deployment validation.`,
    `Deployment: ${params.deploymentName} (${params.sid})`,
    `Telegram: ${botLabel}`,
    `Admin: ${adminUrl}`,
  ].join("\n");
  return {
    subject: `OpenClaw ${params.version} is ready for rollout`,
    html,
    text,
  };
}

function buildFailureNotificationEmail(params: {
  stage: string;
  details: string;
  version: string | null;
  deploymentName: string | null;
  sid: string | null;
  action: string | null;
}) {
  const adminUrl = `${getClawSimpleBaseUrl().replace(/\/+$/, "")}/en/admin/deployments`;
  const deploymentLabel =
    params.deploymentName && params.sid
      ? `${params.deploymentName} (${params.sid})`
      : params.sid ?? "unknown";
  const versionLabel = params.version ?? "unknown";
  const actionLabel = params.action ?? "unknown";
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #18181b;">
      <h2 style="margin: 0 0 12px;">OpenClaw release check failed</h2>
      <ul style="margin: 0 0 16px; padding-left: 18px;">
        <li>Stage: ${params.stage}</li>
        <li>Action: ${actionLabel}</li>
        <li>Version: ${versionLabel}</li>
        <li>Deployment: ${deploymentLabel}</li>
        <li>Details: ${params.details}</li>
      </ul>
      <p style="margin: 0 0 12px;">
        Open the admin deployments page and inspect the deployment fingerprint, runner job status, and Telegram validation.
      </p>
      <p style="margin: 0;">
        <a href="${adminUrl}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#171512;color:#f8f5f0;text-decoration:none;">Open Admin Deployments</a>
      </p>
    </div>
  `;
  const text = [
    "OpenClaw release check failed.",
    `Stage: ${params.stage}`,
    `Action: ${actionLabel}`,
    `Version: ${versionLabel}`,
    `Deployment: ${deploymentLabel}`,
    `Details: ${params.details}`,
    `Admin: ${adminUrl}`,
  ].join("\n");
  return {
    subject: `OpenClaw release check failed: ${params.stage}`,
    html,
    text,
  };
}

async function resolveNotificationRecipients() {
  const envList = (process.env.OPENCLAW_RELEASE_NOTIFY_EMAIL ?? "")
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (envList.length > 0) {
    return Array.from(new Set(envList));
  }

  const adminRows = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, "admin"));
  return Array.from(
    new Set(
      adminRows
        .map((row) => row.email?.trim() ?? "")
        .filter((value) => value.length > 0)
    )
  );
}

async function sendFailureNotification(params: {
  stage: string;
  details: string;
  version: string | null;
  deploymentName: string | null;
  sid: string | null;
  action: string | null;
}) {
  try {
    const recipients = await resolveNotificationRecipients();
    if (recipients.length === 0) {
      return {
        ok: false,
        status: "recipient_missing" as const,
        error: "No OpenClaw release notification recipients are configured.",
      };
    }

    const emailContent = buildFailureNotificationEmail(params);
    for (const recipient of recipients) {
      await sendEmail({
        to: recipient,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }
    return {
      ok: true,
      status: "sent" as const,
      recipients,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return {
      ok: false,
      status: "send_failed" as const,
      error: message,
    };
  }
}

async function findInProgressOpenClawUpgradeJob(sid: string) {
  const pendingJobs = await db
    .select({
      id: deploymentAgentJobs.id,
      jobType: deploymentAgentJobs.jobType,
      status: deploymentAgentJobs.status,
      payload: deploymentAgentJobs.payload,
      createdAt: deploymentAgentJobs.createdAt,
      startedAt: deploymentAgentJobs.startedAt,
      updatedAt: deploymentAgentJobs.updatedAt,
    })
    .from(deploymentAgentJobs)
    .where(
      and(
        eq(deploymentAgentJobs.sid, sid),
        eq(deploymentAgentJobs.jobType, "openclaw_upgrade"),
        inArray(deploymentAgentJobs.status, ["pending", "running"])
      )
    )
    .orderBy(desc(deploymentAgentJobs.createdAt));

  return pendingJobs.find((job) => isAgentJobInProgress(job)) ?? null;
}

async function findRecentOpenClawUpgradeJobs(sid: string) {
  return db
    .select({
      id: deploymentAgentJobs.id,
      jobType: deploymentAgentJobs.jobType,
      status: deploymentAgentJobs.status,
      payload: deploymentAgentJobs.payload,
      errorMessage: deploymentAgentJobs.errorMessage,
      createdAt: deploymentAgentJobs.createdAt,
      updatedAt: deploymentAgentJobs.updatedAt,
      completedAt: deploymentAgentJobs.completedAt,
    })
    .from(deploymentAgentJobs)
    .where(
      and(
        eq(deploymentAgentJobs.sid, sid),
        eq(deploymentAgentJobs.jobType, "openclaw_upgrade")
      )
    )
    .orderBy(desc(deploymentAgentJobs.createdAt))
    .limit(20);
}

type OpenClawJobIssue = {
  status: "failed" | "stuck";
  job: Awaited<ReturnType<typeof findRecentOpenClawUpgradeJobs>>[number];
  details: string;
};

function findUpgradeJobIssueForVersion(
  jobs: Awaited<ReturnType<typeof findRecentOpenClawUpgradeJobs>>,
  version: string,
  currentRunnerVersion: string,
  blockedRunnerVersion: string,
  now: Date,
  staleMinutes: number
): OpenClawJobIssue | null {
  for (const job of jobs) {
    const payload = readJobPayload(job.payload);
    const jobVersion = getJobVersion(payload);
    const rollbackFrom = getJobRollbackFrom(payload);
    if (!jobVersion || !isOpenClawVersionMatch(jobVersion, version) || rollbackFrom) {
      continue;
    }
    const jobRunnerVersion = getJobRunnerVersion(payload);
    if (
      currentRunnerVersion &&
      ((jobRunnerVersion && jobRunnerVersion !== currentRunnerVersion) ||
        (!jobRunnerVersion &&
          blockedRunnerVersion &&
          blockedRunnerVersion !== currentRunnerVersion))
    ) {
      continue;
    }
    if (job.status === "failed") {
      const reason = job.errorMessage?.trim() || "upgrade job failed";
      return {
        status: "failed",
        job,
        details: `upgrade job ${job.id} failed: ${reason}`,
      };
    }
    if (
      ["pending", "running"].includes(job.status) &&
      isOlderThanMinutes(job.createdAt, staleMinutes, now)
    ) {
      return {
        status: "stuck",
        job,
        details: `upgrade job ${job.id} is ${job.status} for more than ${staleMinutes} minutes`,
      };
    }
  }
  return null;
}

function findRollbackJobIssueForVersion(
  jobs: Awaited<ReturnType<typeof findRecentOpenClawUpgradeJobs>>,
  failedVersion: string,
  rollbackVersion: string | null,
  now: Date,
  staleMinutes: number
): OpenClawJobIssue | null {
  for (const job of jobs) {
    const payload = readJobPayload(job.payload);
    const rollbackFrom = getJobRollbackFrom(payload);
    const jobVersion = getJobVersion(payload);
    if (!rollbackFrom || !isOpenClawVersionMatch(rollbackFrom, failedVersion)) {
      continue;
    }
    if (
      rollbackVersion &&
      jobVersion &&
      !isOpenClawVersionMatch(jobVersion, rollbackVersion)
    ) {
      continue;
    }
    if (job.status === "failed") {
      const reason = job.errorMessage?.trim() || "rollback job failed";
      return {
        status: "failed",
        job,
        details: `rollback job ${job.id} failed: ${reason}`,
      };
    }
    if (
      ["pending", "running"].includes(job.status) &&
      isOlderThanMinutes(job.createdAt, staleMinutes, now)
    ) {
      return {
        status: "stuck",
        job,
        details: `rollback job ${job.id} is ${job.status} for more than ${staleMinutes} minutes`,
      };
    }
  }
  return null;
}

function findInProgressRollbackJobForVersion(
  jobs: Awaited<ReturnType<typeof findRecentOpenClawUpgradeJobs>>,
  failedVersion: string,
  rollbackVersion: string | null,
  now: Date,
  staleMinutes: number
) {
  return (
    jobs.find((job) => {
      const payload = readJobPayload(job.payload);
      const rollbackFrom = getJobRollbackFrom(payload);
      const jobVersion = getJobVersion(payload);
      if (!rollbackFrom || !isOpenClawVersionMatch(rollbackFrom, failedVersion)) {
        return false;
      }
      if (
        rollbackVersion &&
        jobVersion &&
        !isOpenClawVersionMatch(jobVersion, rollbackVersion)
      ) {
        return false;
      }
      return (
        ["pending", "running"].includes(job.status) &&
        !isOlderThanMinutes(job.createdAt, staleMinutes, now)
      );
    }) ?? null
  );
}

async function enqueueOpenClawRollback(params: {
  target: {
    sid: string;
    userId: string;
    displayName: string | null;
    serverFingerprint: unknown;
  };
  failedVersion: string;
  rollbackVersion: string | null;
}) {
  if (!params.rollbackVersion) {
    return {
      ok: false,
      status: "skipped_previous_version_missing" as const,
      version: null,
    };
  }
  if (isOpenClawVersionMatch(params.rollbackVersion, params.failedVersion)) {
    return {
      ok: false,
      status: "skipped_same_version" as const,
      version: params.rollbackVersion,
    };
  }

  const inProgressJob = await findInProgressOpenClawUpgradeJob(params.target.sid);
  if (inProgressJob) {
    return {
      ok: true,
      status: "already_in_progress" as const,
      version: params.rollbackVersion,
      job_id: inProgressJob.id,
      job_status: inProgressJob.status,
    };
  }

  try {
    const serviceName = resolveDeploymentServiceName(
      "clawsimple",
      params.target.serverFingerprint,
      params.target.sid
    );
    const jobId = crypto.randomUUID();
    const now = await enqueueAgentJob({
      id: jobId,
      sid: params.target.sid,
      userId: params.target.userId,
      jobType: "openclaw_upgrade",
      payload: {
        service_name: serviceName,
        version: params.rollbackVersion,
        rollback_from: params.failedVersion,
        reason: "openclaw_release_validation_failed",
      },
    });
    return {
      ok: true,
      status: "enqueued" as const,
      version: params.rollbackVersion,
      job_id: jobId,
      created_at: now.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return {
      ok: false,
      status: "enqueue_failed" as const,
      version: params.rollbackVersion,
      error: message,
    };
  }
}

export async function POST(request: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET ?? "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "cron_secret_missing",
        details: "CRON_SECRET must be configured before enabling openclaw-release-check.",
      },
      { status: 503 }
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const testEmail =
    (process.env.OPENCLAW_RELEASE_TEST_EMAIL ?? "").trim() ||
    (process.env.DEPLOY_TEST_EMAIL ?? "").trim();
  if (!testEmail) {
    logReleaseCheck("test_email_missing", {});
    return NextResponse.json(
      {
        ok: false,
        error: "test_email_missing",
        details:
          "OPENCLAW_RELEASE_TEST_EMAIL or DEPLOY_TEST_EMAIL must be configured before enabling openclaw-release-check.",
      },
      { status: 503 }
    );
  }

  const latestVersion = await fetchLatestOpenClawVersion({ force: true });

  const sessions = await db
    .select({
      sid: installSessions.id,
      userId: installSessions.userId,
      email: user.email,
      displayName: installSessions.displayName,
      createdAt: installSessions.createdAt,
      tgTokenCiphertext: installSessions.tgTokenCiphertext,
      serverFingerprint: installSessions.serverFingerprint,
      active: installSessions.active,
      status: installSessions.status,
    })
    .from(installSessions)
    .innerJoin(user, eq(installSessions.userId, user.id))
    .where(
      and(
        eq(user.email, testEmail),
        eq(installSessions.active, true),
        eq(installSessions.status, "completed")
      )
    )
    .orderBy(desc(installSessions.createdAt));

  const target = sessions[0];
  if (!target) {
    const failureNotification = await sendFailureNotification({
      stage: "test_deployment_lookup",
      details: `No active completed deployment found for ${testEmail}.`,
      version: latestVersion,
      deploymentName: null,
      sid: null,
      action: "test_deployment_not_found",
    });
    logReleaseCheck("test_deployment_not_found", {
      latest_openclaw_version: latestVersion,
      test_email: testEmail,
      failure_notification_status: failureNotification.status,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "test_deployment_not_found",
        details: `No active completed dedicated deployment found for ${testEmail}.`,
        latest_openclaw_version: latestVersion,
        failure_notification: failureNotification,
      },
      { status: 404 }
    );
  }
  if (!target.userId) {
    const failureNotification = await sendFailureNotification({
      stage: "test_deployment_lookup",
      details: `Deployment ${target.sid} does not have a user id.`,
      version: latestVersion,
      deploymentName: target.displayName?.trim() || target.sid,
      sid: target.sid,
      action: "test_deployment_user_missing",
    });
    logReleaseCheck("test_deployment_user_missing", {
      latest_openclaw_version: latestVersion,
      sid: target.sid,
      deployment_name: target.displayName?.trim() || target.sid,
      failure_notification_status: failureNotification.status,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "test_deployment_user_missing",
        latest_openclaw_version: latestVersion,
        failure_notification: failureNotification,
      },
      { status: 409 }
    );
  }

  const fingerprint = readFingerprint(target.serverFingerprint);
  const currentVersion =
    typeof fingerprint.openclaw_version === "string"
      ? fingerprint.openclaw_version.trim()
      : "";
  const currentRunnerVersion =
    typeof fingerprint.runner_version === "string"
      ? fingerprint.runner_version.trim()
      : "";
  const normalizedCurrentVersion = normalizeOpenClawVersion(currentVersion);
  const previousReleaseVersion = normalizeOpenClawVersion(
    typeof fingerprint.openclaw_release_previous_version === "string"
      ? fingerprint.openclaw_release_previous_version
      : null
  );
  const blockedReleaseVersion = normalizeOpenClawVersion(
    typeof fingerprint.openclaw_release_blocked_version === "string"
      ? fingerprint.openclaw_release_blocked_version
      : null
  );
  const blockedReleaseRunnerVersion =
    typeof fingerprint.openclaw_release_blocked_runner_version === "string"
      ? fingerprint.openclaw_release_blocked_runner_version.trim()
      : "";
  const rollbackReleaseVersion = normalizeOpenClawVersion(
    typeof fingerprint.openclaw_release_rollback_version === "string"
      ? fingerprint.openclaw_release_rollback_version
      : null
  );
  const lastNotifiedVersion =
    typeof fingerprint.openclaw_release_notified_version === "string"
      ? fingerprint.openclaw_release_notified_version.trim()
      : "";
  const upgradeJobStaleMinutes = getUpgradeJobStaleMinutes();
  const recentOpenClawUpgradeJobs = await findRecentOpenClawUpgradeJobs(target.sid);
  const now = new Date();

  if (!isOpenClawVersionMatch(currentVersion, latestVersion)) {
    if (
      blockedReleaseVersion &&
      isOpenClawVersionMatch(blockedReleaseVersion, latestVersion) &&
      (!blockedReleaseRunnerVersion ||
        !currentRunnerVersion ||
        blockedReleaseRunnerVersion === currentRunnerVersion)
    ) {
      const validationCheckedAt = new Date().toISOString();
      await updateServerFingerprint(target.sid, {
        openclaw_release_validation_checked_at: validationCheckedAt,
        openclaw_release_validation_error: `latest version ${latestVersion} is blocked after validation failure`,
        openclaw_release_tested_version: latestVersion,
      });
      logReleaseCheck("upgrade_blocked", {
        sid: target.sid,
        deployment_name: target.displayName?.trim() || target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion || null,
        blocked_openclaw_version: blockedReleaseVersion,
      });
      return NextResponse.json({
        ok: true,
        action: "upgrade_blocked",
        sid: target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion || null,
        blocked_openclaw_version: blockedReleaseVersion,
      });
    }

    const upgradeIssue = findUpgradeJobIssueForVersion(
      recentOpenClawUpgradeJobs,
      latestVersion,
      currentRunnerVersion,
      blockedReleaseRunnerVersion,
      now,
      upgradeJobStaleMinutes
    );
    if (upgradeIssue) {
      const validationCheckedAt = new Date().toISOString();
      const failureNotification = await sendFailureNotification({
        stage: `upgrade_${upgradeIssue.status}`,
        details: upgradeIssue.details,
        version: latestVersion,
        deploymentName: target.displayName?.trim() || target.sid,
        sid: target.sid,
        action: `upgrade_${upgradeIssue.status}`,
      });
      await updateServerFingerprint(target.sid, {
        openclaw_release_validation_checked_at: validationCheckedAt,
        openclaw_release_validation_error: upgradeIssue.details,
        openclaw_release_tested_version: latestVersion,
        openclaw_release_candidate_version: latestVersion,
        openclaw_release_blocked_version: latestVersion,
        ...(currentRunnerVersion
          ? { openclaw_release_blocked_runner_version: currentRunnerVersion }
          : {}),
        openclaw_release_upgrade_job_id: upgradeIssue.job.id,
        openclaw_release_upgrade_status: upgradeIssue.status,
        openclaw_release_failure_notified_at:
          failureNotification.ok ? validationCheckedAt : null,
        openclaw_release_failure_notified_stage: failureNotification.ok
          ? `upgrade_${upgradeIssue.status}`
          : null,
      });
      logReleaseCheck(`upgrade_${upgradeIssue.status}`, {
        sid: target.sid,
        deployment_name: target.displayName?.trim() || target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion || null,
        job_id: upgradeIssue.job.id,
        job_status: upgradeIssue.job.status,
        details: upgradeIssue.details,
        failure_notification_status: failureNotification.status,
      });
      return NextResponse.json(
        {
          ok: false,
          action: `upgrade_${upgradeIssue.status}`,
          sid: target.sid,
          latest_openclaw_version: latestVersion,
          current_openclaw_version: currentVersion || null,
          details: upgradeIssue.details,
          job_id: upgradeIssue.job.id,
          failure_notification: failureNotification,
        },
        { status: 409 }
      );
    }

    const inProgressJob = await findInProgressOpenClawUpgradeJob(target.sid);
    if (inProgressJob) {
      logReleaseCheck("waiting_for_upgrade", {
        sid: target.sid,
        deployment_name: target.displayName?.trim() || target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion || null,
        job_id: inProgressJob.id,
        job_status: inProgressJob.status,
      });
      return NextResponse.json({
        ok: true,
        action: "waiting_for_upgrade",
        sid: target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion || null,
        job_id: inProgressJob.id,
        job_status: inProgressJob.status,
      });
    }

    const serviceName = resolveDeploymentServiceName(
      "clawsimple",
      target.serverFingerprint,
      target.sid
    );
    const jobId = crypto.randomUUID();
    const jobCreatedAt = await enqueueAgentJob({
      id: jobId,
      sid: target.sid,
      userId: target.userId,
      jobType: "openclaw_upgrade",
      payload: {
        service_name: serviceName,
        version: latestVersion,
        ...(currentRunnerVersion ? { runner_version: currentRunnerVersion } : {}),
      },
    });

    await updateServerFingerprint(target.sid, {
      openclaw_release_validation_checked_at: jobCreatedAt.toISOString(),
      openclaw_release_validation_error: null,
      openclaw_release_tested_version: latestVersion,
      openclaw_release_previous_version:
        normalizedCurrentVersion && !isOpenClawVersionMatch(normalizedCurrentVersion, latestVersion)
          ? normalizedCurrentVersion
          : previousReleaseVersion,
      openclaw_release_candidate_version: latestVersion,
      openclaw_release_blocked_version: null,
      openclaw_release_blocked_runner_version: null,
      openclaw_release_rollback_version: null,
      openclaw_release_rollback_status: null,
      openclaw_release_rollback_job_id: null,
      openclaw_release_rollback_enqueued_at: null,
    });

    logReleaseCheck("upgrade_enqueued", {
      sid: target.sid,
      deployment_name: target.displayName?.trim() || target.sid,
      latest_openclaw_version: latestVersion,
      current_openclaw_version: currentVersion || null,
      job_id: jobId,
    });
    return NextResponse.json({
      ok: true,
      action: "upgrade_enqueued",
      sid: target.sid,
      latest_openclaw_version: latestVersion,
      current_openclaw_version: currentVersion || null,
      job_id: jobId,
      created_at: jobCreatedAt.toISOString(),
    });
  }

  if (blockedReleaseVersion && isOpenClawVersionMatch(blockedReleaseVersion, latestVersion)) {
    const rollbackIssue = findRollbackJobIssueForVersion(
      recentOpenClawUpgradeJobs,
      latestVersion,
      rollbackReleaseVersion ?? previousReleaseVersion,
      now,
      upgradeJobStaleMinutes
    );
    if (rollbackIssue) {
      const validationCheckedAt = new Date().toISOString();
      const notificationStage = `rollback_${rollbackIssue.status}`;
      const previousNotificationStage =
        typeof fingerprint.openclaw_release_failure_notified_stage === "string"
          ? fingerprint.openclaw_release_failure_notified_stage
          : "";
      const previousRollbackJobId =
        typeof fingerprint.openclaw_release_rollback_job_id === "string"
          ? fingerprint.openclaw_release_rollback_job_id
          : "";
      const shouldNotify =
        previousNotificationStage !== notificationStage ||
        previousRollbackJobId !== rollbackIssue.job.id;
      const failureNotification = shouldNotify
        ? await sendFailureNotification({
            stage: notificationStage,
            details: rollbackIssue.details,
            version: latestVersion,
            deploymentName: target.displayName?.trim() || target.sid,
            sid: target.sid,
            action: notificationStage,
          })
        : ({ ok: true, status: "already_sent" as const });
      await updateServerFingerprint(target.sid, {
        openclaw_release_validation_checked_at: validationCheckedAt,
        openclaw_release_validation_error: rollbackIssue.details,
        openclaw_release_tested_version: latestVersion,
        openclaw_release_blocked_version: latestVersion,
        openclaw_release_rollback_status: rollbackIssue.status,
        openclaw_release_rollback_job_id: rollbackIssue.job.id,
        openclaw_release_failure_notified_at:
          failureNotification.ok && shouldNotify
            ? validationCheckedAt
            : fingerprint.openclaw_release_failure_notified_at ?? null,
        openclaw_release_failure_notified_stage: failureNotification.ok
          ? notificationStage
          : null,
      });
      logReleaseCheck(`rollback_${rollbackIssue.status}`, {
        sid: target.sid,
        deployment_name: target.displayName?.trim() || target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion,
        job_id: rollbackIssue.job.id,
        job_status: rollbackIssue.job.status,
        details: rollbackIssue.details,
        failure_notification_status: failureNotification.status,
      });
      return NextResponse.json(
        {
          ok: false,
          action: `rollback_${rollbackIssue.status}`,
          sid: target.sid,
          latest_openclaw_version: latestVersion,
          current_openclaw_version: currentVersion,
          details: rollbackIssue.details,
          job_id: rollbackIssue.job.id,
          failure_notification: failureNotification,
        },
        { status: 409 }
      );
    }
    const rollbackJob = findInProgressRollbackJobForVersion(
      recentOpenClawUpgradeJobs,
      latestVersion,
      rollbackReleaseVersion ?? previousReleaseVersion,
      now,
      upgradeJobStaleMinutes
    );
    if (rollbackJob) {
      const validationCheckedAt = new Date().toISOString();
      await updateServerFingerprint(target.sid, {
        openclaw_release_validation_checked_at: validationCheckedAt,
        openclaw_release_tested_version: latestVersion,
        openclaw_release_blocked_version: latestVersion,
        openclaw_release_rollback_status: "already_in_progress",
        openclaw_release_rollback_job_id: rollbackJob.id,
      });
      logReleaseCheck("waiting_for_rollback", {
        sid: target.sid,
        deployment_name: target.displayName?.trim() || target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion,
        job_id: rollbackJob.id,
        job_status: rollbackJob.status,
      });
      return NextResponse.json({
        ok: true,
        action: "waiting_for_rollback",
        sid: target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion,
        job_id: rollbackJob.id,
        job_status: rollbackJob.status,
      });
    }
  }

  const botToken = decryptBotToken(target.tgTokenCiphertext);
  const getMe = await validateTelegramGetMe(botToken);
  const validationErrors = buildOpenClawReleaseValidationErrors({
    fingerprint,
    telegramValidation: getMe,
  });

  const validationCheckedAt = new Date().toISOString();
  if (validationErrors.length > 0) {
    const details = validationErrors.join("; ");
    const rollback = await enqueueOpenClawRollback({
      target: {
        sid: target.sid,
        userId: target.userId,
        displayName: target.displayName,
        serverFingerprint: target.serverFingerprint,
      },
      failedVersion: latestVersion,
      rollbackVersion: previousReleaseVersion,
    });
    const rollbackDetails = `rollback=${rollback.status}${
      rollback.version ? ` version=${rollback.version}` : ""
    }${"job_id" in rollback && rollback.job_id ? ` job_id=${rollback.job_id}` : ""}${
      "error" in rollback && rollback.error ? ` error=${rollback.error}` : ""
    }`;
    const previousNotificationStage =
      typeof fingerprint.openclaw_release_failure_notified_stage === "string"
        ? fingerprint.openclaw_release_failure_notified_stage
        : "";
    const previousBlockedVersion =
      typeof fingerprint.openclaw_release_blocked_version === "string"
        ? fingerprint.openclaw_release_blocked_version
        : "";
    const previousValidationError =
      typeof fingerprint.openclaw_release_validation_error === "string"
        ? fingerprint.openclaw_release_validation_error
        : "";
    const shouldNotify =
      previousNotificationStage !== "validation" ||
      !isOpenClawVersionMatch(previousBlockedVersion, latestVersion) ||
      previousValidationError !== details;
    const failureNotification = shouldNotify
      ? await sendFailureNotification({
          stage: "validation",
          details: `${details}; ${rollbackDetails}`,
          version: latestVersion,
          deploymentName: target.displayName?.trim() || target.sid,
          sid: target.sid,
          action: "validation_failed",
        })
      : ({ ok: true, status: "already_sent" as const });
    await updateServerFingerprint(target.sid, {
      openclaw_release_validation_checked_at: validationCheckedAt,
      openclaw_release_validation_error: details,
      openclaw_release_tested_version: latestVersion,
      openclaw_release_blocked_version: latestVersion,
      ...(currentRunnerVersion
        ? { openclaw_release_blocked_runner_version: currentRunnerVersion }
        : {}),
      openclaw_release_rollback_version: rollback.version,
      openclaw_release_rollback_status: rollback.status,
      ...("job_id" in rollback && rollback.job_id
        ? { openclaw_release_rollback_job_id: rollback.job_id }
        : {}),
      ...("created_at" in rollback && rollback.created_at
        ? { openclaw_release_rollback_enqueued_at: rollback.created_at }
        : {}),
      openclaw_release_failure_notified_at:
        failureNotification.ok && shouldNotify
          ? validationCheckedAt
          : fingerprint.openclaw_release_failure_notified_at ?? null,
      openclaw_release_failure_notified_stage: failureNotification.ok
        ? "validation"
        : null,
    });
    logReleaseCheck("validation_failed", {
      sid: target.sid,
      deployment_name: target.displayName?.trim() || target.sid,
      latest_openclaw_version: latestVersion,
      current_openclaw_version: currentVersion,
      details,
      rollback,
      failure_notification_status: failureNotification.status,
    });
    return NextResponse.json(
      {
        ok: false,
        action: "validation_failed",
        sid: target.sid,
        latest_openclaw_version: latestVersion,
        current_openclaw_version: currentVersion,
        details,
        rollback,
        failure_notification: failureNotification,
      },
      { status: 409 }
    );
  }

  if (lastNotifiedVersion === latestVersion) {
    await updateServerFingerprint(target.sid, {
      openclaw_release_validation_checked_at: validationCheckedAt,
      openclaw_release_validation_error: null,
      openclaw_release_tested_version: latestVersion,
    });
    const revalidatedPaths = revalidateHomeVersionPages();
    logReleaseCheck("already_notified", {
      sid: target.sid,
      deployment_name: target.displayName?.trim() || target.sid,
      latest_openclaw_version: latestVersion,
      current_openclaw_version: currentVersion,
      revalidated_paths: revalidatedPaths,
    });
    return NextResponse.json({
      ok: true,
      action: "already_notified",
      sid: target.sid,
      latest_openclaw_version: latestVersion,
      current_openclaw_version: currentVersion,
      revalidated_paths: revalidatedPaths,
    });
  }

  const recipients = await resolveNotificationRecipients();
  if (recipients.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "notification_recipient_missing",
        details:
          "Configure OPENCLAW_RELEASE_NOTIFY_EMAIL or ensure at least one admin account has an email.",
      },
      { status: 500 }
    );
  }

  const botUsername =
    getMe.result && typeof getMe.result.username === "string"
      ? getMe.result.username.trim().replace(/^@/, "")
      : null;
  const emailContent = buildNotificationEmail({
    version: latestVersion,
    deploymentName: target.displayName?.trim() || target.sid,
    sid: target.sid,
    botUsername,
  });

  for (const recipient of recipients) {
    await sendEmail({
      to: recipient,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
  }

  await updateServerFingerprint(target.sid, {
    openclaw_release_validation_checked_at: validationCheckedAt,
    openclaw_release_validation_error: null,
    openclaw_release_tested_version: latestVersion,
    openclaw_release_notified_version: latestVersion,
    openclaw_release_notified_at: validationCheckedAt,
    openclaw_release_candidate_version: null,
    openclaw_release_blocked_version: null,
    openclaw_release_rollback_version: null,
    openclaw_release_rollback_status: null,
    openclaw_release_rollback_job_id: null,
    openclaw_release_rollback_enqueued_at: null,
  });
  const revalidatedPaths = revalidateHomeVersionPages();

  logReleaseCheck("notified", {
    sid: target.sid,
    deployment_name: target.displayName?.trim() || target.sid,
    latest_openclaw_version: latestVersion,
    current_openclaw_version: currentVersion,
    recipients_count: recipients.length,
    revalidated_paths: revalidatedPaths,
  });
  return NextResponse.json({
    ok: true,
    action: "notified",
    sid: target.sid,
    latest_openclaw_version: latestVersion,
    current_openclaw_version: currentVersion,
    recipients,
    revalidated_paths: revalidatedPaths,
  });
}
