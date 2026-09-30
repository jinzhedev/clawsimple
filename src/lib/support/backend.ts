export type SupportChatRequest = {
  query: string;
  conversationId?: string;
  visitorId: string;
  toolGrant: string;
  signal: AbortSignal;
};

export type SupportChatReply = {
  answer: string;
  conversationId: string;
};

export interface SupportBackend {
  chat(request: SupportChatRequest): Promise<SupportChatReply>;
}

export class SupportBackendError extends Error {
  constructor(
    public readonly status: 429 | 502 | 504,
    public readonly code?: "budget_exhausted",
  ) {
    super("Support backend unavailable");
  }
}
