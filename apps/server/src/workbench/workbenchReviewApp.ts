import {
  WorkbenchReviewError,
  type WorkbenchReviewQueueEntry,
  type WorkbenchReviewRecord,
  type WorkbenchReviewService,
} from "../../../../packages/workbench-core/src/tasks/workbenchReviewService.ts";
import type { WorkbenchTaskReviewState } from "../../../../packages/workbench-core/src/tasks/workbenchReviewMemoryStore.ts";

/**
 * App port the server's HTTP/WS transport mounts: derive `authenticatedUserId`
 * from the session middleware and forward the parsed JSON body. Mount points:
 * handleQueue reads the personal queue, handleTaskSnapshot reads one task,
 * handleDecide writes a review decision.
 */

export interface WorkbenchReviewRequest<Body = unknown> {
  /** From the server's auth session; null when the caller is anonymous. */
  authenticatedUserId: string | null;
  body?: Body;
}

export interface WorkbenchReviewErrorBody {
  error: { code: string; message: string };
}

export type WorkbenchReviewAppResponse<Body> =
  | { status: 200; body: Body }
  | { status: 401 | 400 | 404 | 409 | 422; body: WorkbenchReviewErrorBody };

export interface WorkbenchReviewApp {
  readonly service: WorkbenchReviewService;
  handleQueue(
    request: WorkbenchReviewRequest,
  ): WorkbenchReviewAppResponse<{ reviews: WorkbenchReviewQueueEntry[] }>;
  handleTaskSnapshot(
    request: WorkbenchReviewRequest & { taskId: string },
  ): WorkbenchReviewAppResponse<{ task: WorkbenchTaskReviewState }>;
  handleDecide(
    request: WorkbenchReviewRequest<Record<string, unknown>>,
  ): WorkbenchReviewAppResponse<{ review: WorkbenchReviewRecord }>;
}

const ERROR_STATUS: Record<string, 400 | 404 | 409 | 422> = {
  invalid_request: 400,
  unknown_task: 404,
  unknown_step: 404,
  review_not_open: 409,
  blank_reason: 422,
  invalid_return_target: 422,
};

function errorResponse(error: WorkbenchReviewError): WorkbenchReviewAppResponse<never> {
  return {
    status: ERROR_STATUS[error.code] ?? 400,
    body: { error: { code: error.code, message: error.message } },
  };
}

export function createWorkbenchReviewApp(deps: {
  service: WorkbenchReviewService;
}): WorkbenchReviewApp {
  const { service } = deps;

  function requireActor(request: WorkbenchReviewRequest): WorkbenchReviewAppResponse<never> | null {
    if (!request.authenticatedUserId) {
      return {
        status: 401,
        body: { error: { code: "unauthenticated", message: "Sign in to see workbench reviews" } },
      };
    }
    return null;
  }

  return {
    service,
    handleQueue(request) {
      const denied = requireActor(request);
      if (denied) return denied;
      // The personal pending queue counts by assigned reviewer (D04); deputies act
      // through decide, which audits them separately.
      const reviews = service.listOpenReviews({ reviewerId: request.authenticatedUserId! });
      return { status: 200, body: { reviews } };
    },

    handleTaskSnapshot(request) {
      const denied = requireActor(request);
      if (denied) return denied;
      const state = service.getTask(request.taskId);
      if (!state) {
        return {
          status: 404,
          body: { error: { code: "unknown_task", message: `Unknown task: ${request.taskId}` } },
        };
      }
      return { status: 200, body: { task: state } };
    },

    handleDecide(request) {
      const denied = requireActor(request);
      if (denied) return denied;
      const body = request.body;
      const taskId = typeof body?.taskId === "string" ? body.taskId : undefined;
      const stepId = typeof body?.stepId === "string" ? body.stepId : undefined;
      const attempt = typeof body?.attempt === "number" ? body.attempt : undefined;
      const decision =
        body?.decision === "approve" || body?.decision === "return" ? body.decision : undefined;
      const reason = typeof body?.reason === "string" ? body.reason : undefined;
      const returnToStepId =
        typeof body?.returnToStepId === "string" ? body.returnToStepId : undefined;
      if (!taskId || !stepId || attempt === undefined || !decision) {
        return {
          status: 400,
          body: {
            error: {
              code: "invalid_request",
              message: "taskId, stepId, attempt and decision are required",
            },
          },
        };
      }
      try {
        const review = service.decideReview(
          { taskId, stepId, attempt, decision, reason, returnToStepId },
          // The actor comes from authentication only; any actor field in the payload
          // is deliberately not read (D03).
          { actorId: request.authenticatedUserId! },
        );
        return { status: 200, body: { review } };
      } catch (error) {
        if (error instanceof WorkbenchReviewError) return errorResponse(error);
        throw error;
      }
    },
  };
}
