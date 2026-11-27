// 版本与任务的双向关联（故事 18、19；裁决 R01）。
// 调用按任务记录的版本 ID 计算：同名同版本的卡片合并为一个版本的调用清单。
import type { TaskRecord, WorkflowVersionSnapshot } from "./types.ts";

export interface VersionInvocations {
  versionId: string;
  workflowId: string;
  workflowName: string;
  count: number;
  tasks: TaskRecord[];
}

export function versionInvocations(
  tasks: TaskRecord[],
  versions: WorkflowVersionSnapshot[],
): VersionInvocations[] {
  const byVersion = new Map<string, VersionInvocations>();
  for (const task of tasks) {
    let entry = byVersion.get(task.versionId);
    if (!entry) {
      const version = versions.find((candidate) => candidate.versionId === task.versionId);
      entry = {
        versionId: task.versionId,
        workflowId: version?.workflowId ?? task.workflowId,
        workflowName: version?.workflowName ?? "",
        count: 0,
        tasks: [],
      };
      byVersion.set(task.versionId, entry);
    }
    entry.count += 1;
    entry.tasks.push(task);
  }
  return [...byVersion.values()];
}

/** 流程卡上的真实调用数：按版本 ID 去重统计，同名同版本合并（R01）。 */
export function invocationCountForVersion(tasks: TaskRecord[], versionId: string): number {
  return tasks.filter((task) => task.versionId === versionId).length;
}
