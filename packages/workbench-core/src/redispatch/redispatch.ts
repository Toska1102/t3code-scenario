// 再次派发计划与字段重匹配（故事 29、31；裁决 D10）。
// 默认沿用历史任务的确切版本；只能显式切到同流程已确认版本；同版本列表按版本 ID 过滤（R01）。
import type { DispatchFieldDef, TaskRecord, WorkflowVersionSnapshot } from "./types.ts";

export interface RedispatchPlan {
  defaultVersionId: string;
  selectedVersionId: string;
  switchableVersions: WorkflowVersionSnapshot[];
  sameVersionTasks: TaskRecord[];
}

export function planRedispatch(input: {
  source: { kind: "version"; versionId: string } | { kind: "task"; task: TaskRecord };
  versions: WorkflowVersionSnapshot[];
  tasks: TaskRecord[];
  selectedVersionId?: string;
}): RedispatchPlan {
  const defaultVersionId =
    input.source.kind === "task" ? input.source.task.versionId : input.source.versionId;
  const confirmed = input.versions.filter((version) => version.status === "confirmed");
  const sameWorkflow = confirmed.filter(
    (version) =>
      version.workflowId ===
      input.versions.find((candidate) => candidate.versionId === defaultVersionId)?.workflowId,
  );
  const selectedVersionId = input.selectedVersionId ?? defaultVersionId;
  return {
    defaultVersionId,
    selectedVersionId,
    switchableVersions: sameWorkflow.some((version) => version.versionId === selectedVersionId)
      ? sameWorkflow
      : [
          ...sameWorkflow,
          ...confirmed.filter((version) => version.versionId === selectedVersionId),
        ],
    sameVersionTasks: input.tasks.filter((task) => task.versionId === selectedVersionId),
  };
}

export interface RematchedField extends DispatchFieldDef {
  value: string;
}

export interface FieldRematchResult {
  fields: RematchedField[];
  /** 目标版本必填但当前无值的字段，含因版本切换新增的必填项。 */
  missingRequired: DispatchFieldDef[];
  /** 相对上一版本新增的必填字段 ID，提交界面需明确提示补填。 */
  newRequiredFieldIds: string[];
}

export function rematchFields(
  target: WorkflowVersionSnapshot,
  previousFields: DispatchFieldDef[],
  currentValues: Record<string, string>,
  reusePreviousMaterials: boolean,
): FieldRematchResult {
  const fields = target.fields.map((field) => ({
    ...field,
    value: reusePreviousMaterials ? (currentValues[field.id] ?? "") : "",
  }));
  const missingRequired = fields.filter((field) => field.required && field.value === "");
  const previousFieldIds = new Set(previousFields.map((field) => field.id));
  const newRequiredFieldIds = target.fields
    .filter((field) => field.required && !previousFieldIds.has(field.id))
    .map((field) => field.id);
  return { fields, missingRequired, newRequiredFieldIds };
}
