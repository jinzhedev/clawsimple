import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  date,
  index,
  numeric,
  primaryKey,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").notNull().default("user"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const supportRateLimit = pgTable(
  "support_rate_limit",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("support_rate_limit_expires_idx").on(table.expiresAt)],
);

export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  plan: text("plan").notNull(),
  referenceId: text("reference_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  status: text("status").notNull().default("incomplete"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  cancelAt: timestamp("cancel_at"),
  canceledAt: timestamp("canceled_at"),
  endedAt: timestamp("ended_at"),
  seats: integer("seats"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Stripe billing cache (DB projection). Stripe remains the source of truth.
export const billingCustomerCache = pgTable(
  "billing_customer_cache",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.stripeCustomerId] }),
    customerIdx: index("billing_customer_cache_customer_id_idx").on(
      table.stripeCustomerId,
    ),
  }),
);

export const billingSubscription = pgTable(
  "billing_subscription",
  {
    stripeSubscriptionId: text("stripe_subscription_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    status: text("status").notNull(),
    stripeCreatedAt: timestamp("stripe_created_at"),
    // "Canceling" flag as displayed in UI (includes schedule cancel and cancel_at).
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelAt: timestamp("cancel_at"),
    canceledAt: timestamp("canceled_at"),
    endedAt: timestamp("ended_at"),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("billing_subscription_user_id_idx").on(table.userId),
    customerIdx: index("billing_subscription_customer_id_idx").on(
      table.stripeCustomerId,
    ),
  }),
);

export const billingSubscriptionItem = pgTable(
  "billing_subscription_item",
  {
    stripeSubscriptionItemId: text("stripe_subscription_item_id").primaryKey(),
    stripeSubscriptionId: text("stripe_subscription_id")
      .notNull()
      .references(() => billingSubscription.stripeSubscriptionId, {
        onDelete: "cascade",
      }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    status: text("status").notNull(),
    subscriptionCreatedAt: timestamp("subscription_created_at"),
    // Denormalized cancellation info from subscription.
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelAt: timestamp("cancel_at"),
    priceId: text("price_id").notNull(),
    quantity: integer("quantity").notNull().default(0),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    archivedAt: timestamp("archived_at"),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("billing_subscription_item_user_id_idx").on(table.userId),
    customerIdx: index("billing_subscription_item_customer_id_idx").on(
      table.stripeCustomerId,
    ),
    priceIdx: index("billing_subscription_item_price_id_idx").on(table.priceId),
    userArchivedIdx: index("billing_subscription_item_user_archived_idx").on(
      table.userId,
      table.archivedAt,
    ),
  }),
);

export const usageCreditBalance = pgTable(
  "usage_credit_balance",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .primaryKey(),
    balanceUsd: numeric("balance_usd", {
      precision: 12,
      scale: 6,
    })
      .notNull()
      .default("0"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    updatedIdx: index("usage_credit_balance_updated_idx").on(table.updatedAt),
  }),
);

export const usageCreditGrant = pgTable(
  "usage_credit_grant",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountUsd: numeric("amount_usd", {
      precision: 12,
      scale: 6,
    }).notNull(),
    remainingUsd: numeric("remaining_usd", {
      precision: 12,
      scale: 6,
    }).notNull(),
    sourceType: text("source_type"), // stripe_checkout | legacy_balance | admin_adjust
    sourceId: text("source_id"),
    note: text("note"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userExpiresIdx: index("usage_credit_grant_user_expires_idx").on(
      table.userId,
      table.expiresAt,
    ),
    sourceUnique: unique("usage_credit_grant_source_unique").on(
      table.sourceType,
      table.sourceId,
    ),
  }),
);

export const usageCreditLedger = pgTable(
  "usage_credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountUsd: numeric("amount_usd", {
      precision: 12,
      scale: 6,
    }).notNull(),
    entryType: text("entry_type").notNull(), // purchase | consume | adjust | expire
    sourceType: text("source_type"), // stripe_checkout | proxy_request | admin_adjust | legacy_balance
    sourceId: text("source_id"),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index("usage_credit_ledger_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    sourceUnique: unique("usage_credit_ledger_source_unique").on(
      table.sourceType,
      table.sourceId,
    ),
  }),
);

export const telegramAccountLink = pgTable(
  "telegram_account_link",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .unique(),
    telegramUserId: text("telegram_user_id").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("telegram_account_link_user_id_idx").on(table.userId),
    telegramIdx: index("telegram_account_link_tg_user_id_idx").on(
      table.telegramUserId,
    ),
  }),
);

export const installStatusEnum = pgEnum("install_status", [
  "created",
  "started",
  "completed",
  "failed",
  "terminated",
]);

export const deployPresetTierEnum = pgEnum("deploy_preset_tier", [
  "economy",
  "standard",
  "premium",
]);

export const contentVideoSurfaceEnum = pgEnum("content_video_surface", [
  "home_openclaw",
  "deploy_clawsimple",
]);

export const installSessions = pgTable("install_sessions", {
  id: text("id").primaryKey(),
  seatId: text("seat_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  displayName: text("display_name"),
  telegramUsername: text("telegram_username"),
  locale: text("locale").notNull().default("en"),
  channel: text("channel").notNull(),
  status: installStatusEnum("status").default("created").notNull(),
  active: boolean("active").notNull().default(false),
  seatStatus: text("seat_status"),
  seatPlan: text("seat_plan"),
  pendingSeatPlan: text("pending_seat_plan"),
  pendingSeatEffectiveAt: timestamp("pending_seat_effective_at"),
  lastModel: text("last_model"),
  exaMode: text("exa_mode"),
  exaApiKeyCiphertext: text("exa_api_key_ciphertext"),
  searchCrawlMode: text("search_crawl_mode"),
  searchCrawlApiKeyCiphertext: text("search_crawl_api_key_ciphertext"),
  mailgunApiKeyCiphertext: text("mailgun_api_key_ciphertext"),
  mailgunBackupEmail: text("mailgun_backup_email"),
  mailgunInboxAddress: text("mailgun_inbox_address"),
  mailgunDomain: text("mailgun_domain"),
  mailgunAgentId: text("mailgun_agent_id"),
  mailgunTelegramTarget: text("mailgun_telegram_target"),
  presetProxyBaseUrl: text("preset_proxy_base_url"),
  presetProxyModel: text("preset_proxy_model"),
  presetProxyModels: text("preset_proxy_models"),
  presetProxyApiKeyCiphertext: text("preset_proxy_api_key_ciphertext"),
  tgTokenCiphertext: text("tg_token_ciphertext"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeSubscriptionItemId: text("stripe_subscription_item_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  graceUntil: timestamp("grace_until"),
  seatRemoveAt: timestamp("seat_remove_at"),
  completedAt: timestamp("completed_at"),
  errorCode: text("error_code"),
  deployAgentTokenHash: text("deploy_agent_token_hash"),
  serverFingerprint: json("server_fingerprint").$type<{
    os?: string;
    arch?: string;
    installer_version?: string;
    error_code?: string;
    deploy_provider?: string;
    server_id?: string | number;
    server_name?: string;
    server_ipv4?: string;
    server_ipv6?: string;
    server_type?: string;
    server_location?: string;
    runner_revision?: string;
    runner_label?: string;
    runner_version?: string;
    runner_capabilities?: string[];
    runtime_mode?: string;
    gateway_restart_policy?: string;
    gateway_service_active?: boolean;
    openclaw_version?: string;
    openclaw_requested_version?: string;
    openclaw_upgrade_strategy?: string;
    openclaw_last_upgraded_at?: string;
    openclaw_release_tested_version?: string;
    openclaw_release_validation_checked_at?: string;
    openclaw_release_validation_error?: string | null;
    openclaw_release_notified_version?: string;
    openclaw_release_notified_at?: string;
    hermes_agent_installed?: boolean;
    hermes_agent_version?: string;
    hermes_agent_requested_version?: string;
    hermes_agent_last_upgraded_at?: string;
    hermes_release_tested_version?: string;
    hermes_release_validation_checked_at?: string;
    hermes_release_validation_error?: string | null;
    hermes_release_notified_version?: string;
    hermes_release_notified_at?: string;
    hermes_release_blocked_version?: string | null;
    hermes_release_upgrade_job_id?: string | null;
    hermes_release_upgrade_status?: string | null;
    agent_runtimes?: Record<
      string,
      {
        status?: string | null;
        active_runtime?: string | null;
        target_runtime?: string | null;
        account_id?: string | null;
        model?: string | null;
        hermes_service_name?: string | null;
        openclaw_service_state?: string | null;
        hermes_service_state?: string | null;
        error_message?: string | null;
        job_id?: string | null;
        started_at?: string | null;
        completed_at?: string | null;
      }
    >;
  }>(),
});

export type InstallSession = typeof installSessions.$inferSelect;

export const adminCustomerNotes = pgTable(
  "admin_customer_notes",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    updatedIdx: index("admin_customer_notes_updated_idx").on(table.updatedAt),
  }),
);

export const deploymentAgentJobs = pgTable(
  "deployment_agent_jobs",
  {
    id: text("id").primaryKey(),
    sid: text("sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    payload: json("payload").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sidStatusIdx: index("deployment_agent_jobs_sid_status_idx").on(
      table.sid,
      table.status,
    ),
    sidUpdatedIdx: index("deployment_agent_jobs_sid_updated_idx").on(
      table.sid,
      table.updatedAt,
    ),
    userIdx: index("deployment_agent_jobs_user_idx").on(table.userId),
  }),
);

export const deploymentAgents = pgTable(
  "deployment_agents",
  {
    sid: text("sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    displayName: text("display_name"),
    telegramUsername: text("telegram_username"),
    accountId: text("account_id"),
    model: text("model"),
    runtime: text("runtime").notNull().default("openclaw"),
    tgTokenCiphertext: text("tg_token_ciphertext"),
    isPrimary: boolean("is_primary").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sid, table.agentId] }),
    sidActiveIdx: index("deployment_agents_sid_active_idx").on(
      table.sid,
      table.active,
    ),
    sidUpdatedIdx: index("deployment_agents_sid_updated_idx").on(
      table.sid,
      table.updatedAt,
    ),
  }),
);

export const telegramBotTokenAssignments = pgTable(
  "telegram_bot_token_assignments",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    sid: text("sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    releasedAt: timestamp("released_at"),
  },
  (table) => ({
    activeTokenUnique: uniqueIndex(
      "telegram_bot_token_assignments_active_token_uniq",
    )
      .on(table.tokenHash)
      .where(sql`${table.active} = true`),
    sidAgentIdx: index("telegram_bot_token_assignments_sid_agent_idx").on(
      table.sid,
      table.agentId,
      table.active,
    ),
  }),
);

export const deploymentAgentJobSecrets = pgTable(
  "deployment_agent_job_secrets",
  {
    jobId: text("job_id")
      .primaryKey()
      .references(() => deploymentAgentJobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
);

export const deploymentAgentWake = pgTable(
  "deployment_agent_wake",
  {
    sid: text("sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" })
      .primaryKey(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    updatedIdx: index("deployment_agent_wake_updated_idx").on(table.updatedAt),
  }),
);

export const deploymentBackups = pgTable(
  "deployment_backups",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceSid: text("source_sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    objectKey: text("object_key"),
    sizeBytes: integer("size_bytes"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index("deployment_backups_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    sourceSidIdx: index("deployment_backups_source_sid_idx").on(
      table.sourceSid,
    ),
  }),
);

export const deploymentBackupPasswords = pgTable(
  "deployment_backup_passwords",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seatKey: text("seat_key").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.seatKey] }),
    userUpdatedIdx: index("deployment_backup_passwords_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const deployPresetUsageDaily = pgTable(
  "deploy_preset_usage_daily",
  {
    subscriptionItemId: text("subscription_item_id").notNull(),
    day: date("day").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    seatPlan: text("seat_plan").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    lastModel: text("last_model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueSubscriptionDay: unique().on(table.subscriptionItemId, table.day),
  }),
);

export const deployPresetUsageSeatDaily = pgTable(
  "deploy_preset_usage_seat_daily",
  {
    sid: text("sid")
      .notNull()
      .references(() => installSessions.id, { onDelete: "cascade" }),
    seatId: text("seat_id"),
    subscriptionItemId: text("subscription_item_id").notNull(),
    day: date("day").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    seatPlan: text("seat_plan").notNull(),
    modelId: text("model_id"),
    requestCount: integer("request_count").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    providerCostUsd: numeric("provider_cost_usd", {
      precision: 12,
      scale: 6,
    })
      .notNull()
      .default("0"),
    costEstimatedUsd: numeric("cost_estimated_usd", {
      precision: 12,
      scale: 6,
    })
      .notNull()
      .default("0"),
    lastModel: text("last_model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueSidDay: unique().on(table.sid, table.day),
    uniqueSeatDay: unique("deploy_preset_usage_seat_daily_seat_day_uniq").on(
      table.seatId,
      table.day,
    ),
  }),
);

export const deployPresetModels = pgTable(
  "deploy_preset_models",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    provider: text("provider").notNull(),
    tier: deployPresetTierEnum("tier"),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    activeSortIdx: index("deploy_preset_models_active_sort_idx").on(
      table.isActive,
      table.sortOrder,
      table.createdAt,
    ),
  }),
);

export const deployPresetPricingRules = pgTable(
  "deploy_preset_pricing_rules",
  {
    id: text("id").primaryKey(),
    seatPlan: text("seat_plan").notNull(),
    modelId: text("model_id"),
    tier: deployPresetTierEnum("tier"),
    unitPriceUsd: numeric("unit_price_usd", {
      precision: 12,
      scale: 6,
    }).notNull(),
    effectiveFrom: timestamp("effective_from").notNull(),
    effectiveTo: timestamp("effective_to"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    activePlanTimeIdx: index(
      "deploy_preset_pricing_rules_active_plan_time_idx",
    ).on(table.isActive, table.seatPlan, table.effectiveFrom),
    modelRuleUniq: unique("deploy_preset_pricing_rules_model_rule_uniq").on(
      table.seatPlan,
      table.modelId,
      table.effectiveFrom,
    ),
    tierRuleUniq: unique("deploy_preset_pricing_rules_tier_rule_uniq").on(
      table.seatPlan,
      table.tier,
      table.effectiveFrom,
    ),
  }),
);

export const contentVideos = pgTable(
  "content_videos",
  {
    id: text("id").primaryKey(),
    surface: contentVideoSurfaceEnum("surface").notNull(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    surfaceSortIdx: index("content_videos_surface_sort_idx").on(
      table.surface,
      table.isActive,
      table.sortOrder,
      table.createdAt,
    ),
  }),
);

// ==========================================
// Feature Voting / Roadmap Schema
// ==========================================

// Feature Request status enum
export const featureStatusEnum = pgEnum("feature_status", [
  "considering", // Under consideration
  "planned", // Planned for development
  "in-progress", // Currently in development
  "completed", // Released
  "rejected", // Not planned
]);

// Feature Request category enum
export const featureCategoryEnum = pgEnum("feature_category", [
  "core", // Core features
  "integration", // Integrations
  "ui", // User interface
  "billing", // Billing & payments
  "other", // Other
]);

// Feature Request table
export const featureRequest = pgTable("feature_request", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: featureStatusEnum("status").default("considering").notNull(),
  category: featureCategoryEnum("category").default("other").notNull(),
  submittedBy: text("submitted_by").references(() => user.id, {
    onDelete: "set null",
  }),
  isPaidUser: boolean("is_paid_user").default(false).notNull(),
  releaseDate: timestamp("release_date"),
  releaseNote: text("release_note"),
  requiresRedeploy: boolean("requires_redeploy").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vote intensity enum
export const voteIntensityEnum = pgEnum("vote_intensity", [
  "want", // Want it (weight: 1)
  "need", // Need it urgently (weight: 2)
]);

// Feature Vote table
export const featureVote = pgTable(
  "feature_vote",
  {
    id: text("id").primaryKey(),
    featureId: text("feature_id")
      .notNull()
      .references(() => featureRequest.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    intensity: voteIntensityEnum("intensity").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Each user can only vote once per feature
    uniqueUserFeature: unique().on(table.featureId, table.userId),
  }),
);

export type FeatureRequest = typeof featureRequest.$inferSelect;
export type FeatureVote = typeof featureVote.$inferSelect;

// ==========================================
// Email Unsubscribe Schema
// ==========================================

export const emailUnsubscribe = pgTable("email_unsubscribe", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  token: text("token").notNull().unique(),
  source: text("source").default("marketing"), // marketing, transactional, etc.
  unsubscribedAt: timestamp("unsubscribed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EmailUnsubscribe = typeof emailUnsubscribe.$inferSelect;
