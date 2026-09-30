// @vitest-environment node
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { expect, it } from "vitest";
import { SUPPORT_LIMITS } from "@/config/support";
it("ships a bounded Chatflow with portable knowledge and tool bindings", () => {
  const app = parse(readFileSync("support/dify/app.yml", "utf8"));
  expect(app.app.mode).toBe("advanced-chat");
  const nodes = app.workflow.graph.nodes;
  const agent = nodes.find((n: { id: string }) => n.id === "agent").data
    .agent_parameters;
  expect(agent.model.value.model).toBe("deepseek-flash");
  expect(agent.model.value.completion_params.enable_thinking).toBe(false);
  expect(agent.model.value.completion_params.max_tokens).toBe(
    SUPPORT_LIMITS.outputTokens,
  );
  expect(agent.maximum_iterations.value).toBe(SUPPORT_LIMITS.modelCalls);
  expect(agent.tools.value).toHaveLength(1);
  expect(agent.tools.value[0].tool_name).toBe("list_my_deployments");
  expect(agent.tools.value[0].provider_name).toBe("REPLACE_TOOL_PROVIDER_ID");
  expect(agent.tools.value[0].parameters.Authorization).toEqual({
    auto: 0,
    value: { type: "variable", value: ["start", "deployment_grant"] },
  });
  expect(agent.instruction.value).not.toContain("support_run_id");
  expect(agent.instruction.value).toContain("{{#knowledge.result#}}");
  const knowledge = nodes.find(
    (n: { id: string }) => n.id === "knowledge",
  ).data;
  expect(knowledge.dataset_ids).toEqual(["REPLACE_KNOWLEDGE_ID"]);
  expect(knowledge.multiple_retrieval_config.reranking_enable).toBe(true);
  expect(knowledge.multiple_retrieval_config.reranking_model.model).toBe(
    "BAAI/bge-reranker-v2-m3",
  );
  expect(app.dependencies).toHaveLength(3);
});

it("versions gateway authentication, budgets and explicit cache bypass", () => {
  const policy = JSON.parse(
    readFileSync("support/gateway/policy.json", "utf8"),
  );
  expect(policy).toMatchObject({
    authentication: true,
    byok_only: true,
    cache_ttl: 0,
    collect_logs: false,
    rate_limiting_limit: 20,
  });
  expect(policy.spend_limits.enabled).toBe(true);
  expect(
    JSON.parse(readFileSync("support/gateway/request-headers.json", "utf8")),
  ).toEqual({ "cf-aig-skip-cache": "true" });
  expect(
    policy.spend_limits.rules.map((rule: { limit: number }) => rule.limit),
  ).toEqual([3, 0.5]);
});
