import type { SupportBackend } from "./backend";
import { createDifyBackend } from "./dify-backend";

export function getSupportBackend(): SupportBackend | null {
  const baseUrl = process.env.DIFY_API_URL?.trim();
  const apiKey = process.env.DIFY_API_KEY?.trim();
  return baseUrl && apiKey ? createDifyBackend(baseUrl, apiKey) : null;
}
