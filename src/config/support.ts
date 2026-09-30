export function isSupportChatEnabled() {
  return process.env.SUPPORT_CHAT_PUBLIC_ENABLED === "true";
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSupportInputLimits() {
  return {
    queryCodeUnits: positiveInteger(
      process.env.SUPPORT_CHAT_MAX_QUERY_LENGTH,
      2000,
    ),
    bodyBytes: positiveInteger(process.env.SUPPORT_CHAT_MAX_BODY_BYTES, 8192),
  };
}

export const SUPPORT_LIMITS = {
  ipRequests: 6,
  ipWindowSeconds: 60,
  modelCalls: 3,
  outputTokens: 700,
  toolGrantSeconds: 120,
} as const;
