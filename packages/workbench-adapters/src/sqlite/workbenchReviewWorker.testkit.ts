import * as NodeSqlite from "node:sqlite";
import * as NodeWorkerThreads from "node:worker_threads";

import {
  createWorkbenchReviewService,
  WorkbenchReviewError,
} from "../../../workbench-core/src/tasks/workbenchReviewService.ts";
import { createWorkbenchReviewSqliteStore } from "./workbenchReviewSqliteStore.ts";

const { path, actorId } = NodeWorkerThreads.workerData as { path: string; actorId: string };
const database = new NodeSqlite.DatabaseSync(path);
const service = createWorkbenchReviewService({ store: createWorkbenchReviewSqliteStore(database) });
NodeWorkerThreads.parentPort!.once("message", () => {
  try {
    const review = service.decideReview(
      { taskId: "task-025", stepId: "review", attempt: 1, decision: "approve", requestId: actorId },
      { actorId },
    );
    NodeWorkerThreads.parentPort!.postMessage({ status: "approved", review }, []);
  } catch (error) {
    if (!(error instanceof WorkbenchReviewError)) throw error;
    NodeWorkerThreads.parentPort!.postMessage({ status: error.code }, []);
  } finally {
    database.close();
    NodeWorkerThreads.parentPort!.close();
  }
});
NodeWorkerThreads.parentPort!.postMessage("ready", []);
