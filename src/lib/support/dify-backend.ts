import { SupportBackendError, type SupportBackend } from "./backend";
import { stripThinkBlocks } from "./strip-reasoning";

export function createDifyBackend(
  baseUrl: string,
  apiKey: string,
): SupportBackend {
  return {
    async chat({ query, conversationId, visitorId, signal }) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat-messages`, {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal,
          body: JSON.stringify({
            inputs: {},
            query,
            conversation_id: conversationId ?? "",
            user: visitorId,
            response_mode: "blocking",
            auto_generate_name: false,
          }),
        });
      } catch {
        throw new SupportBackendError(504);
      }
      if (!response.ok) {
        throw new SupportBackendError(response.status === 429 ? 429 : 502);
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw new SupportBackendError(502);
      }
      const answer =
        typeof result?.answer === "string"
          ? stripThinkBlocks(result.answer)
          : "";
      if (
        !answer ||
        typeof result?.conversation_id !== "string" ||
        !result.conversation_id
      ) {
        throw new SupportBackendError(502);
      }
      return { answer, conversationId: result.conversation_id };
    },
  };
}
