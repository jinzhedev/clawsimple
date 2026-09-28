export function cleanDifyAnswer(answer: string) {
  // Some providers wrap reasoning in the answer field rather than metadata.
  // Drop an unfinished reasoning block too, so partial output stays private.
  return answer.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}
