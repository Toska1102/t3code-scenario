import * as NodeAssert from "node:assert/strict";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(import.meta.url);
const { init } = require(process.env.WORKBENCH_Z3_MODULE ?? "z3-solver");
const { Context } = await init();
const z = new Context("workbench");

const scenarios = [
  [
    "P01",
    ["blankName", "validProject"],
    (a, b) => a.implies(b.not()),
    "A whitespace-only name cannot produce a project. A team is optional.",
  ],
  [
    "P02",
    ["movedTeam", "historicalTeamChanged"],
    (a, b) => a.implies(b.not()),
    "Moving the project affects new tasks and preserves historical attribution.",
  ],
  [
    "P03",
    ["unauthenticated", "writeAccepted"],
    (a, b) => a.implies(b.not()),
    "Every authenticated admin may write. Anonymous calls may not.",
  ],
  [
    "A01",
    ["historicalRun", "autoUpgradeVersion"],
    (a, b) => a.implies(b.not()),
    "A historical task uses the exact pinned workflow version.",
  ],
  [
    "A02",
    ["rolledBack", "engineStarted"],
    (a, b) => a.implies(b.not()),
    "T3 starts after the business transaction commits.",
  ],
  [
    "A03",
    ["noSavedResult", "taskCompleted"],
    (a, b) => a.implies(b.not()),
    "Completion requires a saved formal result.",
  ],
  [
    "A04",
    ["returnedAttempt", "reusedApproval"],
    (a, b) => a.implies(b.not()),
    "Returning a dependent output invalidates its approval.",
  ],
  [
    "A05",
    ["sameDispatchKey", "differentTasks"],
    (a, b) => a.implies(b.not()),
    "Retrying a dispatch key yields the same registered task.",
  ],
  [
    "D01",
    ["agentOffline", "confirmationBlockedSolelyByHealth"],
    (a, b) => a.implies(b.not()),
    "Confirmation evaluates structure. Dispatch evaluates live availability.",
  ],
  [
    "D02",
    ["orgChangedAfterPreview", "usedPreviewRevision"],
    (a, b) => a.implies(b.not()),
    "Dispatch validates and records the same current organization revision.",
  ],
  [
    "D03",
    ["deputyActs", "deputyOwnsTodo"],
    (a, b) => a.implies(b.not()),
    "The assigned reviewer retains ownership until resolution. The deputy is audited separately.",
  ],
  [
    "D04",
    ["assignedToSomeoneElse", "countedInMyTodo"],
    (a, b) => a.implies(b.not()),
    "Each personal task count uses the assigned reviewer.",
  ],
  [
    "D06",
    ["formalResultSaveFailed", "markedCompleted"],
    (a, b) => a.implies(b.not()),
    "The task remains pending delivery until the formal result is saved.",
  ],
  [
    "D07",
    ["retryDelivery", "rerunCompletedSteps"],
    (a, b) => a.implies(b.not()),
    "Retry delivery with existing output and approval.",
  ],
  [
    "D08",
    ["sameDispatchSubmission", "allocatedAnotherTask"],
    (a, b) => a.implies(b.not()),
    "Unknown response retries reuse the existing receipt.",
  ],
  [
    "D09",
    ["instanceStoppedBeforeStep", "stepStarted"],
    (a, b) => a.implies(b.not()),
    "A queued step checks current instance availability before launch.",
  ],
  [
    "D10",
    ["historicalTask", "openedLatestVersion"],
    (a, b) => a.implies(b.not()),
    "Workflow history opens the version recorded by the task.",
  ],
  [
    "D11",
    ["resultReadFailed", "completedTaskReopened"],
    (a, b) => a.implies(b.not()),
    "A read failure only affects display.",
  ],
  [
    "P04",
    ["hardLimitUnenforceable", "dispatchAccepted"],
    (a, b) => a.implies(b.not()),
    "Unknown or unsupported required enforcement blocks dispatch.",
  ],
  [
    "R02",
    ["publishedVersion", "updatedStepsInPlace"],
    (a, b) => a.implies(b.not()),
    "Editing creates a revision and preserves the published version.",
  ],
  [
    "R03",
    ["hasNoTeam", "firstDispatchAccepted"],
    (a, b) => a.implies(b.not()),
    "Team selection is required to dispatch.",
  ],
  [
    "R04",
    ["dispatchedFromDraft", "createdTaskWithoutPinnedVersion"],
    (a, b) => a.implies(b.not()),
    "The dispatch transaction confirms the draft and creates the task referencing that version.",
  ],
  [
    "R05",
    ["includedOnlyAsAncestor", "assignedWithoutApplicableDuty"],
    (a, b) => a.implies(b.not()),
    "The ancestors expand the candidate pool.",
  ],
  [
    "R07",
    ["enabledButNotAuthenticated", "markedAvailable"],
    (a, b) => a.implies(b.not()),
    "Enabled and authenticated are independent.",
  ],
  [
    "R08",
    ["unverifiedModel", "dispatchWithModelAccepted"],
    (a, b) => a.implies(b.not()),
    "Dispatch with a custom model requires verification.",
  ],
  [
    "R09",
    ["disabledAfterStart", "activeStepAbortedByDisable"],
    (a, b) => a.implies(b.not()),
    "Already-started steps use the execution snapshot.",
  ],
  [
    "R10",
    ["reviewReturnsWork", "mutatedPublishedGraph"],
    (a, b) => a.implies(b.not()),
    "Return creates a new attempt against the same graph.",
  ],
  [
    "R11",
    ["switchToDifferentTask", "sendToOldTaskThread"],
    (a, b) => a.implies(b.not()),
    "The send route uses the selected task and step IDs.",
  ],
  [
    "R12",
    ["directoryRequiredButUnavailable", "dispatchAccepted"],
    (a, b) => a.implies(b.not()),
    "A directory is optional unless the workflow requires one.",
  ],
];

async function check(expressions) {
  const solver = new z.Solver();
  for (const [, expression] of expressions) solver.add(expression);
  return solver.check();
}

async function verifyCore(id, facts, revised, decision) {
  NodeAssert.equal(await check(facts), "unsat", id);
  for (let index = 0; index < facts.length; index++) {
    NodeAssert.equal(
      await check(facts.filter((_, other) => other !== index)),
      "sat",
      `${id} core member ${index}`,
    );
  }
  NodeAssert.equal(await check(revised), "sat", id);
  console.log(
    `${id} UNSAT (${facts.map(([name]) => name).join(", ")}); revised scenario SAT. ${decision}`,
  );
}

for (const [id, labels, rule, decision] of scenarios) {
  const [condition, conflict] = labels.map((name) => z.Bool.const(`${id}_${name}`));
  const facts = [
    [`${id}_${labels[0]}_given`, condition],
    [`${id}_${labels[1]}_given`, conflict],
    [`${id}_decision`, rule(condition, conflict)],
  ];
  await verifyCore(id, facts, [facts[0], [`${id}_resolved`, conflict.not()], facts[2]], decision);
}

const firstCard = z.Int.const("firstCard");
const secondCard = z.Int.const("secondCard");
const listCount = z.Int.const("listCount");
await verifyCore(
  "R01",
  [
    ["first_sample_call_count", firstCard.eq(2)],
    ["second_sample_call_count", secondCard.eq(1)],
    ["one_version_one_count", firstCard.eq(secondCard)],
  ],
  [
    ["first", firstCard.eq(listCount)],
    ["second", secondCard.eq(listCount)],
    ["three_active_calls", listCount.eq(3)],
  ],
  "The exact workflow version has one reverse list with three calls.",
);

const approvedAttempt = z.Int.const("approvedAttempt");
const currentAttempt = z.Int.const("currentAttempt");
await verifyCore(
  "D05",
  [
    ["previous_approval", approvedAttempt.eq(1)],
    ["new_output", currentAttempt.eq(2)],
    ["delivery_requires_current_approval", approvedAttempt.eq(currentAttempt)],
  ],
  [
    ["new_approval", approvedAttempt.eq(2)],
    ["new_output", currentAttempt.eq(2)],
    ["current_approval", approvedAttempt.eq(currentAttempt)],
  ],
  "An approval belongs to a specific attempt.",
);

const stepA = z.Bool.const("stepA");
const stepB = z.Bool.const("stepB");
const reviewOpen = z.Bool.const("reviewOpen");
await verifyCore(
  "R06",
  [
    ["branch_b_pending", stepB.not()],
    ["review_opens", reviewOpen],
    ["review_waits_for_both_branches", reviewOpen.implies(z.And(stepA, stepB))],
  ],
  [
    ["completed_branches", z.And(stepA, stepB)],
    ["review_can_open", reviewOpen],
  ],
  "All direct upstream steps must succeed before opening review.",
);

const codexDefault = z.Bool.const("codexDefault");
const claudeDefault = z.Bool.const("claudeDefault");
await verifyCore(
  "R13",
  [
    ["codex_default", codexDefault],
    ["claude_default", claudeDefault],
    ["at_most_one_default", z.And(codexDefault, claudeDefault).not()],
  ],
  [
    ["codex_default", codexDefault],
    ["claude_not_default", claudeDefault.not()],
  ],
  "An environment has at most one default instance.",
);
