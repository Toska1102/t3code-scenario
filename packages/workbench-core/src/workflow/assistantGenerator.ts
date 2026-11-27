import type {
  WorkflowDraft,
  WorkflowStepConfig,
} from "../../../workbench-contracts/src/workflow/types.ts";
import { applicableReviewRules } from "./members.ts";
import type { WorkflowGenerationRequest, WorkflowGenerator } from "./generator.ts";

/**
 * Deterministic default 项目助手 (story 23): one chained execution step per
 * selected member, then a human review step for every review rule that applies
 * to the workflow name. It needs no model, so the create-and-confirm flow works
 * end to end without an LLM; a smarter generator can replace it at the seam.
 */
export function createAssistantGenerator(): WorkflowGenerator {
  return {
    generate: async ({
      draft,
      teamGraph,
      coverage,
    }: WorkflowGenerationRequest): Promise<unknown> => {
      const nodeById = new Map(teamGraph.nodes.map((node) => [node.id, node]));
      const steps: Array<Record<string, unknown>> = [];
      let previousId: string | null = null;
      let index = 0;
      for (const memberId of draft.memberIds) {
        const node = nodeById.get(memberId);
        if (!node) continue;
        const id = `gen-${(index += 1)}`;
        steps.push({
          id,
          title: `${node.name} 初审`,
          ownerId: memberId,
          mode: "execution",
          dependsOn: previousId ? [previousId] : [],
          config: stepConfig(node.name, node.tools, node.tokens, node.model, draft, index),
        });
        previousId = id;
      }
      for (const rule of coverage.appliedReviewRules.length
        ? coverage.appliedReviewRules
        : applicableReviewRules(teamGraph, draft.name)) {
        const reviewer = nodeById.get(rule.reviewerNodeId);
        if (!reviewer || !previousId) continue;
        const id = `gen-${(index += 1)}`;
        steps.push({
          id,
          title: `${reviewer.name} 复审`,
          ownerId: reviewer.id,
          mode: "humanReview",
          dependsOn: [previousId],
          config: stepConfig(
            reviewer.name,
            reviewer.tools,
            reviewer.tokens,
            reviewer.model,
            draft,
            index,
          ),
        });
        previousId = id;
      }
      return steps;
    },
  };
}

function stepConfig(
  roleName: string,
  tools: string,
  tokens: number,
  model: string,
  draft: WorkflowDraft,
  index: number,
): WorkflowStepConfig {
  return {
    prompt: `你是 ${roleName}。请按照下面的说明处理这项工作：${draft.description}`,
    inputRefs: draft.inputFields
      .filter((field) => field.required && field.kind !== "file")
      .map((field) => ({ kind: "dispatch" as const, fieldKey: field.key })),
    outputKey: `output-${index}`,
    outputLabel: `${roleName}的产出`,
    tools,
    tokens: Math.min(6000, tokens),
    model,
  };
}
