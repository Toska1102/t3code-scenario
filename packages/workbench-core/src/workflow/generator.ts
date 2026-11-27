import {
  type TeamGraphSnapshot,
  type WorkflowDraft,
  type WorkflowProblem,
  type WorkflowResult,
  type WorkflowStep,
  type WorkflowStepConfig,
  type WorkflowStepMode,
} from "../../../workbench-contracts/src/workflow/types.ts";
import type { CoveragePreview } from "./members.ts";

export interface WorkflowGenerationRequest {
  draft: WorkflowDraft;
  teamGraph: TeamGraphSnapshot;
  coverage: CoveragePreview;
}

/**
 * The generator seam (story 23). Implementations call a model and return raw
 * JSON; nothing here executes or trusts the output — `parseGeneratedSteps`
 * validates it as untrusted data before it becomes a draft.
 */
export interface WorkflowGenerator {
  generate(request: WorkflowGenerationRequest): Promise<unknown>;
}

function invalid(message: string): WorkflowProblem {
  return { code: "generator.output.invalid", target: { kind: "workflow" }, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(
  raw: unknown,
  fieldKeys: Set<string>,
  stepIds: Set<string>,
): WorkflowStepConfig | WorkflowProblem[] {
  if (!isRecord(raw)) return [invalid("步骤配置缺失或不是对象。")];
  const problems: WorkflowProblem[] = [];
  const prompt = raw.prompt;
  const outputKey = raw.outputKey;
  const tools = raw.tools;
  const model = raw.model;
  const tokens = raw.tokens;
  if (typeof prompt !== "string") problems.push(invalid("步骤提示词必须是字符串。"));
  if (typeof outputKey !== "string" || !outputKey.trim())
    problems.push(invalid("步骤输出必须是字符串。"));
  if (typeof tools !== "string") problems.push(invalid("步骤工具必须是字符串。"));
  if (typeof model !== "string") problems.push(invalid("步骤模型必须是字符串。"));
  if (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens <= 0)
    problems.push(invalid("步骤 Token 必须是正整数。"));
  if (problems.length) return problems;
  const inputRefs: WorkflowStepConfig["inputRefs"] = [];
  if (Array.isArray(raw.inputRefs)) {
    for (const ref of raw.inputRefs) {
      if (!isRecord(ref)) {
        problems.push(invalid("输入来源必须是对象。"));
        continue;
      }
      if (ref.kind === "dispatch" && typeof ref.fieldKey === "string") {
        if (!fieldKeys.has(ref.fieldKey)) {
          problems.push(invalid(`输入来源引用了不存在的派发输入「${String(ref.fieldKey)}」。`));
          continue;
        }
        inputRefs.push({ kind: "dispatch", fieldKey: ref.fieldKey });
      } else if (ref.kind === "step" && typeof ref.stepId === "string") {
        if (!stepIds.has(ref.stepId)) {
          problems.push(invalid(`输入来源引用了不存在的步骤「${String(ref.stepId)}」。`));
          continue;
        }
        inputRefs.push({ kind: "step", stepId: ref.stepId });
      } else {
        problems.push(invalid("输入来源格式不正确。"));
      }
    }
  }
  if (problems.length) return problems;
  return {
    prompt: prompt as string,
    inputRefs,
    outputKey: outputKey as string,
    outputLabel: typeof raw.outputLabel === "string" ? raw.outputLabel : (outputKey as string),
    tools: tools as string,
    tokens: tokens as number,
    model: model as string,
  };
}

/** Validates raw model output into WorkflowStep values without executing anything. */
export function parseGeneratedSteps(
  raw: unknown,
  draft: WorkflowDraft,
  graph: TeamGraphSnapshot,
): WorkflowResult<WorkflowStep[]> {
  if (!Array.isArray(raw) || raw.some((entry) => !isRecord(entry))) {
    return { ok: false, problems: [invalid("生成的流程草稿不是步骤数组。")] };
  }
  const fieldKeys = new Set(draft.inputFields.map((field) => field.key));
  const candidateIds = new Set(graph.nodes.map((node) => node.id));
  const problems: WorkflowProblem[] = [];
  const steps: WorkflowStep[] = [];
  for (const [index, entry] of raw.entries()) {
    const id =
      typeof entry.id === "string" && entry.id.trim() ? entry.id : `generated-${index + 1}`;
    const stepIds = new Set(
      raw
        .filter(isRecord)
        .map((other, otherIndex) =>
          typeof other.id === "string" && other.id.trim()
            ? other.id
            : `generated-${otherIndex + 1}`,
        ),
    );
    const title = typeof entry.title === "string" ? entry.title : "";
    const ownerId = typeof entry.ownerId === "string" ? entry.ownerId : "";
    const mode =
      entry.mode === "humanReview"
        ? "humanReview"
        : entry.mode === "execution"
          ? "execution"
          : null;
    if (!title.trim()) problems.push(invalid(`第 ${index + 1} 个步骤缺少名称。`));
    if (!ownerId || !candidateIds.has(ownerId))
      problems.push(invalid(`「${title || id}」的负责人不在团队组织中。`));
    if (!mode) problems.push(invalid(`「${title || id}」的执行方式无效。`));
    const dependsOn = Array.isArray(entry.dependsOn)
      ? entry.dependsOn.filter(
          (dependency: unknown): dependency is string => typeof dependency === "string",
        )
      : [];
    if (dependsOn.some((dependency: string) => !stepIds.has(dependency)))
      problems.push(invalid(`「${title || id}」依赖了未知步骤。`));
    const config = parseConfig(entry.config, fieldKeys, stepIds);
    if (Array.isArray(config)) problems.push(...config);
    else {
      steps.push({
        id,
        title,
        ownerId,
        mode: (mode ?? "execution") as WorkflowStepMode,
        dependsOn,
        position: { x: index * 280, y: 140 },
        config,
      });
    }
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: steps };
}
