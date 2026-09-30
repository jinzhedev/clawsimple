import { SupportBackendError, type SupportBackend } from "./backend";
import { stripThinkBlocks } from "./strip-reasoning";

export function createDifyBackend(
  baseUrl: string,
  apiKey: string,
): SupportBackend {
  return {
    async chat({ query, conversationId, visitorId, toolGrant, signal }) {
      let response: Response;
      try {
        const parameters = await fetch(
          `${baseUrl.replace(/\/$/, "")}/parameters`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
            cache: "no-store",
            redirect: "error",
          },
        );
        if (!parameters.ok) throw new SupportBackendError(502);
        const config = await parameters.json();
        const fields = (
          Array.isArray(config?.user_input_form) ? config.user_input_form : []
        ).flatMap(
          (item: Record<string, { variable?: string; required?: boolean }>) =>
            Object.values(item),
        );
        if (
          !["deployment_grant"].every((name) =>
            fields.some(
              (field: { variable?: string; required?: boolean }) =>
                field?.variable === name && field.required,
            ),
          )
        )
          throw new SupportBackendError(502);
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
            inputs: {
              deployment_grant: `Bearer ${toolGrant}`,
            },
            query,
            conversation_id: conversationId ?? "",
            user: visitorId,
            response_mode: "blocking",
            auto_generate_name: false,
          }),
        });
      } catch (error) {
        if (error instanceof SupportBackendError) throw error;
        throw new SupportBackendError(504);
      }
      if (!response.ok) {
        // Dify wraps provider errors in its own non-2xx response.
        const detail = await response.json().catch(() => null);
        const message =
          typeof detail?.message === "string" ? detail.message : "";
        if (
          message.includes("Spend limit exceeded:") &&
          message.includes("2045")
        )
          throw new SupportBackendError(429, "budget_exhausted");
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
