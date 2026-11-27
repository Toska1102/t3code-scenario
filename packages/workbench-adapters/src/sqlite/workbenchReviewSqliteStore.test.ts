// @effect-diagnostics nodeBuiltinImport:off -- The restart test launches a separate Node process on a temporary SQLite file.
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTest from "node:test";
import * as NodeUtil from "node:util";
import * as NodeWorkerThreads from "node:worker_threads";

import { createWorkbenchReviewService } from "../../../workbench-core/src/tasks/workbenchReviewService.ts";
import type { WorkbenchReviewEvent } from "../../../workbench-core/src/tasks/workbenchReviewService.ts";
import { createWorkbenchReviewSqliteStore } from "./workbenchReviewSqliteStore.ts";

function openService(path: string) {
  const database = new NodeSqlite.DatabaseSync(path);
  const service = createWorkbenchReviewService({
    store: createWorkbenchReviewSqliteStore(database),
    now: () => "2026-11-27T08:00:00.000Z",
  });
  return { database, service };
}

function seedReview(service: ReturnType<typeof createWorkbenchReviewService>) {
  service.createTask({
    taskId: "task-025",
    steps: [
      { stepId: "draft", dependsOn: [], executor: "Codex" },
      { stepId: "review", dependsOn: ["draft"], executor: "HR", reviewerId: "reviewer" },
    ],
  });
  service.completeStep({ taskId: "task-025", stepId: "draft" });
}

NodeTest.test(
  "a reopened SQLite service retains the pending queue and deputy decision audit across a process restart",
  async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-review-"));
    const path = NodePath.join(directory, "reviews.sqlite");
    const first = openService(path);
    try {
      seedReview(first.service);
    } finally {
      first.database.close();
    }
    const second = openService(path);
    try {
      NodeAssert.deepEqual(second.service.listOpenReviews({ reviewerId: "reviewer" }), [
        {
          taskId: "task-025",
          stepId: "review",
          attempt: 1,
          assignedReviewerId: "reviewer",
          executor: "HR",
        },
      ]);
      second.service.decideReview(
        { taskId: "task-025", stepId: "review", attempt: 1, decision: "approve" },
        { actorId: "deputy" },
      );
    } finally {
      second.database.close();
    }
    const third = openService(path);
    try {
      NodeAssert.equal(third.service.getTask("task-025")?.stepRuns.review?.status, "approved");
      NodeAssert.deepEqual(third.service.listOpenReviews(), []);
      NodeAssert.deepEqual(
        third.service.getReviewHistory({ taskId: "task-025", stepId: "review" }),
        [
          {
            taskId: "task-025",
            stepId: "review",
            attempt: 1,
            status: "approved",
            assignedReviewerId: "reviewer",
            decidedByActorId: "deputy",
            decidedAt: "2026-11-27T08:00:00.000Z",
          },
        ],
      );
    } finally {
      third.database.close();
    }
    try {
      const { stdout } = await NodeUtil.promisify(NodeChildProcess.execFile)(process.execPath, [
        "--input-type=module",
        "--eval",
        `
      import * as NodeSqlite from 'node:sqlite';
      import { createWorkbenchReviewService } from ${JSON.stringify(new URL("../../../workbench-core/src/tasks/workbenchReviewService.ts", import.meta.url).href)};
      import { createWorkbenchReviewSqliteStore } from ${JSON.stringify(new URL("./workbenchReviewSqliteStore.ts", import.meta.url).href)};
      const database = new NodeSqlite.DatabaseSync(${JSON.stringify(path)});
      const service = createWorkbenchReviewService({ store: createWorkbenchReviewSqliteStore(database) });
      console.log(JSON.stringify(service.getTask('task-025')));
      database.close();
    `,
      ]);
      const restarted = JSON.parse(stdout) as ReturnType<typeof first.service.getTask>;
      NodeAssert.equal(restarted?.stepRuns.review!.status, "approved");
      NodeAssert.equal(restarted?.reviews[0]?.decidedByActorId, "deputy");
      NodeAssert.equal(restarted?.reviews[0]?.assignedReviewerId, "reviewer");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "a lost return response retries the same durable decision after reopening without another attempt",
  () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-review-retry-"));
    const path = NodePath.join(directory, "reviews.sqlite");
    const input = {
      taskId: "task-025",
      stepId: "review",
      attempt: 1,
      decision: "return" as const,
      reason: "Missing evidence",
      returnToStepId: "draft",
      requestId: "decision-025",
    };
    const first = openService(path);
    let decision;
    let snapshot;
    try {
      seedReview(first.service);
      decision = first.service.decideReview(input, { actorId: "deputy" });
      snapshot = first.service.getTask("task-025");
    } finally {
      first.database.close();
    }
    const reopened = openService(path);
    try {
      NodeAssert.deepEqual(reopened.service.decideReview(input, { actorId: "deputy" }), decision);
      NodeAssert.deepEqual(reopened.service.getTask("task-025"), snapshot);
      NodeAssert.equal(reopened.service.getTask("task-025")?.stepRuns.draft?.attempt, 2);
      NodeAssert.throws(
        () =>
          reopened.service.decideReview({ ...input, reason: "Different" }, { actorId: "deputy" }),
        { code: "idempotency_conflict" },
      );
      NodeAssert.throws(() => reopened.service.decideReview(input, { actorId: "another-admin" }), {
        code: "idempotency_conflict",
      });
    } finally {
      reopened.database.close();
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "rework closes competing old waits and a stale decision cannot approve the new attempt",
  () => {
    const { database, service } = openService(":memory:");
    try {
      service.createTask({
        taskId: "parallel",
        steps: [
          { stepId: "draft", dependsOn: [], executor: "Codex" },
          { stepId: "first", dependsOn: ["draft"], executor: "HR", reviewerId: "reviewer" },
          { stepId: "second", dependsOn: ["draft"], executor: "HR", reviewerId: "reviewer" },
        ],
      });
      service.completeStep({ taskId: "parallel", stepId: "draft" });
      service.decideReview(
        {
          taskId: "parallel",
          stepId: "first",
          attempt: 1,
          decision: "return",
          reason: "Redo",
          returnToStepId: "draft",
        },
        { actorId: "deputy" },
      );
      NodeAssert.deepEqual(service.listOpenReviews(), []);
      NodeAssert.equal(
        service.getReviewHistory({ taskId: "parallel", stepId: "second" })[0]?.status,
        "invalidated",
      );
      service.completeStep({ taskId: "parallel", stepId: "draft" });
      const before = service.getTask("parallel");
      NodeAssert.throws(
        () =>
          service.decideReview(
            { taskId: "parallel", stepId: "second", attempt: 1, decision: "approve" },
            { actorId: "reviewer" },
          ),
        { code: "review_not_open" },
      );
      NodeAssert.deepEqual(service.getTask("parallel"), before);
      NodeAssert.deepEqual(
        service.listOpenReviews().map((review) => review.attempt),
        [2, 2],
      );
    } finally {
      database.close();
    }
  },
);

NodeTest.test(
  "an audit write failure rolls back the decision, every rework attempt, version and notifications",
  () => {
    const database = new NodeSqlite.DatabaseSync(":memory:");
    const events: WorkbenchReviewEvent[] = [];
    const service = createWorkbenchReviewService({
      store: createWorkbenchReviewSqliteStore(database),
      onEvent: (event) => events.push(event),
    });
    try {
      seedReview(service);
      events.length = 0;
      const before = service.getTask("task-025");
      database.exec(`CREATE TRIGGER fail_review_audit BEFORE UPDATE ON workbench_reviews
      BEGIN SELECT RAISE(ABORT, 'audit storage unavailable'); END`);
      NodeAssert.throws(
        () =>
          service.decideReview(
            {
              taskId: "task-025",
              stepId: "review",
              attempt: 1,
              decision: "return",
              reason: "Redo",
              returnToStepId: "draft",
              requestId: "retry-after-failure",
            },
            { actorId: "deputy" },
          ),
        /audit storage unavailable/,
      );
      NodeAssert.deepEqual(service.getTask("task-025"), before);
      NodeAssert.equal(events.length, 0);
      database.exec("DROP TRIGGER fail_review_audit");
      service.decideReview(
        {
          taskId: "task-025",
          stepId: "review",
          attempt: 1,
          decision: "return",
          reason: "Redo",
          returnToStepId: "draft",
          requestId: "retry-after-failure",
        },
        { actorId: "deputy" },
      );
      NodeAssert.equal(service.getTask("task-025")?.stepRuns.draft?.attempt, 2);
      NodeAssert.equal(
        service.getReviewHistory({ taskId: "task-025", stepId: "review" }).length,
        1,
      );
      NodeAssert.deepEqual(
        events.map((event) => event.type),
        ["attempt.created", "attempt.created", "review.decided"],
      );
    } finally {
      database.close();
    }
  },
);

NodeTest.test(
  "competing administrators on independent SQLite connections commit exactly one audited decision",
  async () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workbench-review-race-"));
    const path = NodePath.join(directory, "reviews.sqlite");
    const { database, service } = openService(path);
    const workers: NodeWorkerThreads.Worker[] = [];
    try {
      seedReview(service);
      const beforeVersion = service.getTask("task-025")!.version;
      const actors = ["admin-one", "admin-two"];
      const contenders = actors.map((actorId) => {
        const worker = new NodeWorkerThreads.Worker(
          new URL("./workbenchReviewWorker.testkit.ts", import.meta.url),
          {
            workerData: { path, actorId },
          },
        );
        workers.push(worker);
        return {
          worker,
          ready: NodeEvents.EventEmitter.once(worker, "message"),
          exited: NodeEvents.EventEmitter.once(worker, "exit"),
        };
      });
      await Promise.all(contenders.map((contender) => contender.ready));
      const results = contenders.map(({ worker }) =>
        NodeEvents.EventEmitter.once(worker, "message"),
      );
      for (const { worker } of contenders) worker.postMessage("decide", []);
      const messages = await Promise.all(results);
      await Promise.all(contenders.map((contender) => contender.exited));
      NodeAssert.deepEqual(messages.map(([message]) => message.status).sort(), [
        "approved",
        "review_not_open",
      ]);
      NodeAssert.equal(service.getTask("task-025")!.version, beforeVersion + 1);
      const history = service.getReviewHistory({ taskId: "task-025", stepId: "review" });
      NodeAssert.equal(history.length, 1);
      const winner = messages.find(([message]) => message.status === "approved")![0];
      NodeAssert.equal(history[0]?.decidedByActorId, winner.review.decidedByActorId);
      NodeAssert.equal(history[0]?.assignedReviewerId, "reviewer");
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      database.close();
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);

NodeTest.test(
  "completion retries cannot overwrite review gates or apply an old output to rework",
  () => {
    const { database, service } = openService(":memory:");
    try {
      seedReview(service);
      const waiting = service.getTask("task-025");
      service.completeStep({ taskId: "task-025", stepId: "draft", attempt: 1 });
      NodeAssert.deepEqual(service.getTask("task-025"), waiting);
      NodeAssert.throws(
        () => service.completeStep({ taskId: "task-025", stepId: "review", attempt: 1 }),
        { code: "invalid_step_completion" },
      );
      service.decideReview(
        {
          taskId: "task-025",
          stepId: "review",
          attempt: 1,
          decision: "return",
          reason: "Redo",
          returnToStepId: "draft",
        },
        { actorId: "reviewer" },
      );
      const rework = service.getTask("task-025");
      NodeAssert.throws(
        () => service.completeStep({ taskId: "task-025", stepId: "draft", attempt: 1 }),
        {
          code: "invalid_step_completion",
        },
      );
      NodeAssert.deepEqual(service.getTask("task-025"), rework);
      service.completeStep({ taskId: "task-025", stepId: "draft", attempt: 2 });
      NodeAssert.deepEqual(
        service.listOpenReviews().map((review) => review.attempt),
        [2],
      );
    } finally {
      database.close();
    }
  },
);

NodeTest.test(
  "approval opens the next review only after commit and a completion cannot undo approval",
  () => {
    const { database, service } = openService(":memory:");
    try {
      service.createTask({
        taskId: "chain",
        steps: [
          { stepId: "draft", dependsOn: [], executor: "Codex" },
          { stepId: "first", dependsOn: ["draft"], executor: "HR", reviewerId: "reviewer" },
          { stepId: "second", dependsOn: ["first"], executor: "HR", reviewerId: "reviewer" },
        ],
      });
      service.completeStep({ taskId: "chain", stepId: "draft" });
      NodeAssert.deepEqual(
        service.listOpenReviews().map((review) => review.stepId),
        ["first"],
      );
      service.decideReview(
        { taskId: "chain", stepId: "first", attempt: 1, decision: "approve" },
        { actorId: "deputy" },
      );
      NodeAssert.deepEqual(
        service.listOpenReviews().map((review) => review.stepId),
        ["second"],
      );
      const approved = service.getTask("chain");
      NodeAssert.throws(() => service.completeStep({ taskId: "chain", stepId: "first" }), {
        code: "invalid_step_completion",
      });
      NodeAssert.deepEqual(service.getTask("chain"), approved);
    } finally {
      database.close();
    }
  },
);
