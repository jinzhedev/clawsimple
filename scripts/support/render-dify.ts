import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse, stringify } from "yaml";
import dotenv from "dotenv";

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const envFile = value("--env");
const env = {
  ...process.env,
  ...(envFile ? dotenv.parse(readFileSync(envFile)) : {}),
};
const dataset = env.DIFY_SUPPORT_DATASET_ID;
const tool = env.DIFY_SUPPORT_TOOL_PROVIDER_ID;
if (
  !dataset ||
  !tool ||
  ![dataset, tool].every((id) => /^[a-f0-9-]{36}$/.test(id))
) {
  throw new Error(
    "Set DIFY_SUPPORT_DATASET_ID and DIFY_SUPPORT_TOOL_PROVIDER_ID in the local environment file.",
  );
}
const output = resolve(value("--out") ?? "tmp/support/app.yml");
if (output === resolve("support/dify/app.yml"))
  throw new Error("Do not overwrite the portable definition.");
const app = parse(readFileSync("support/dify/app.yml", "utf8"));
const nodes = app.workflow.graph.nodes;
nodes.find((node: { id: string }) => node.id === "knowledge").data.dataset_ids =
  [dataset];
nodes.find(
  (node: { id: string }) => node.id === "agent",
).data.agent_parameters.tools.value[0].provider_name = tool;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, stringify(app, { lineWidth: 100 }), { mode: 0o600 });
console.log(
  "Rendered Chatflow definition. Import into the test workspace before publishing.",
);
