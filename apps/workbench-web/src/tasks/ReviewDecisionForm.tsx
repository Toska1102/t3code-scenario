import { useState } from "react";

import type { WorkbenchReviewRecord } from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore";
import { affectedDownstream, findOpenReview, statusLabel } from "./workbenchReviewUi.logic";
import type { ReviewDiagramStep } from "./workbenchReviewUi.logic";
import "./workbenchReview.css";

export interface ReviewDecision {
  attempt: number;
  decision: "approve" | "return";
  reason: string;
  returnToStepId?: string;
}

export type ReviewActionError = { code: string; message: string };

export function ReviewDecisionForm(props: {
  taskId: string;
  steps: readonly ReviewDiagramStep[];
  reviews: readonly WorkbenchReviewRecord[];
  currentUserId: string;
  onDecide: (input: ReviewDecision) => Promise<void>;
}) {
  const reviewStep =
    props.steps.find((step) => step.status === "waitingReview") ??
    props.steps.find((step) => step.reviewerId !== undefined);
  const openReview = reviewStep ? findOpenReview(props.reviews, reviewStep.stepId) : undefined;
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<ReviewActionError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!reviewStep) {
    return (
      <section className="review-decision" aria-label="评审">
        <p className="review-empty">本任务没有需要人工评审的步骤。</p>
      </section>
    );
  }

  if (!openReview) {
    const record = [...props.reviews]
      .filter((candidate) => candidate.stepId === reviewStep.stepId)
      .sort((a, b) => b.attempt - a.attempt)[0];
    return (
      <section className="review-decision" aria-label="评审">
        <h3>复核审核建议</h3>
        {record ? (
          <dl className="review-record">
            <dt>状态</dt>
            <dd>{record.status === "approved" ? "已通过" : "已退回"}</dd>
            <dt>指定负责人</dt>
            <dd>{record.assignedReviewerId}</dd>
            <dt>实际操作人</dt>
            <dd>{record.decidedByActorId ?? "未记录"}</dd>
            <dt>产出尝试</dt>
            <dd>#{record.attempt}</dd>
            {record.decidedAt ? (
              <>
                <dt>处理时间</dt>
                <dd>{record.decidedAt}</dd>
              </>
            ) : null}
            {record.reason ? (
              <>
                <dt>退回原因</dt>
                <dd>{record.reason}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="review-empty">评审尚未开始：等待全部前置步骤完成。</p>
        )}
      </section>
    );
  }

  const upstreams = props.steps.filter(
    (step) => reviewStep.dependsOn.includes(step.stepId) && step.stepId !== reviewStep.stepId,
  );
  const candidates =
    upstreams.length > 0
      ? upstreams
      : props.steps.filter((step) => step.stepId !== reviewStep.stepId);
  const downstream = target ? affectedDownstream(props.steps, target) : [];
  const isDeputy = openReview.assignedReviewerId !== props.currentUserId;

  const submit = async (decision: "approve" | "return") => {
    setError(null);
    setSubmitting(true);
    try {
      await props.onDecide({
        attempt: openReview.attempt,
        decision,
        reason,
        ...(decision === "return" ? { returnToStepId: target } : {}),
      });
    } catch (caught) {
      setError(caught as ReviewActionError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="review-decision" aria-label="评审">
      <h3>
        复核审核建议 <span className="review-attempt">#{openReview.attempt}</span>
        {isDeputy ? (
          <span className="review-deputy">代办 · 指定负责人 {openReview.assignedReviewerId}</span>
        ) : null}
      </h3>
      <div className="review-actions">
        <button
          type="button"
          className="review-approve"
          disabled={submitting}
          onClick={() => submit("approve")}
        >
          通过
        </button>
        <button
          type="button"
          className="review-return"
          disabled={submitting || reason.trim().length === 0 || target.length === 0}
          onClick={() => submit("return")}
        >
          退回
        </button>
      </div>
      <div className="review-fields">
        <label htmlFor="review-reason">退回原因（必填）</label>
        <textarea
          id="review-reason"
          value={reason}
          required
          onChange={(event) => setReason(event.target.value)}
          placeholder="说明这条产出为什么需要返工"
        />
        <label htmlFor="review-target">返工目标</label>
        <select
          id="review-target"
          value={target}
          required
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">选择要返工的步骤</option>
          {candidates.map((step) => (
            <option key={step.stepId} value={step.stepId}>
              {step.stepId} · {statusLabel(step.status)}
            </option>
          ))}
        </select>
        <p aria-live="polite" className="review-impact">
          {downstream.length > 0
            ? `受影响下游：${downstream.join("、")}，退回后将创建新尝试并需重新评审。`
            : "选择返工目标后显示受影响的下游步骤。"}
        </p>
      </div>
      {error ? (
        <p role="alert" className="review-error">
          操作失败（{error.code}）：{error.message}
        </p>
      ) : null}
      <p className="review-note">
        重复提交不会产生额外评审结果；其他管理员处理后将显示其操作记录。
      </p>
    </section>
  );
}
