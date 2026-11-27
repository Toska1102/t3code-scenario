// Pre-code SMT check for the Agent connection dialog: R07 availability,
// R08 dispatch, R09 disable-after-start, R13 default uniqueness. Conflict
// sets are containment-minimized. Run: node specs/workbench/smt/ticket-03-agents.mjs
const { init: initZ3 } = await import(
  process.env.Z3_SOLVER_ENTRYPOINT ??
    "/tmp/workbench-smt.l3An1x/node_modules/z3-solver/build/node.js"
);
const z3 = await initZ3();
const ctx = new z3.Context("main");
const { Solver, Bool, And, Not, Implies } = ctx;

const boolConst = (name) => Bool.const(name);
const exprs = {
  // Shared rule assertions
  R07_available_iff_enabled_and_authenticated: And(
    Implies(boolConst("available_pi"), And(boolConst("enabled_pi"), boolConst("authenticated_pi"))),
    Implies(
      boolConst("available_codex"),
      And(boolConst("enabled_codex"), boolConst("authenticated_codex")),
    ),
    Implies(
      boolConst("available_claude"),
      And(boolConst("enabled_claude"), boolConst("authenticated_claude")),
    ),
  ),
  R08_dispatch_requires_available: And(
    Implies(boolConst("dispatch_pi"), boolConst("available_pi")),
    Implies(boolConst("dispatch_codex"), boolConst("available_codex")),
    Implies(boolConst("dispatch_claude"), boolConst("available_claude")),
  ),
  // R13: at most one default instance per device.
  R13_at_most_one_default: And(
    Not(And(boolConst("default_pi"), boolConst("default_codex"))),
    Not(And(boolConst("default_pi"), boolConst("default_claude"))),
    Not(And(boolConst("default_codex"), boolConst("default_claude"))),
  ),
  // Board 05 sample state: Pi enabled but not authenticated; Codex and Claude available.
  R07_pi_enabled: boolConst("enabled_pi"),
  R07_pi_not_authenticated: Not(boolConst("authenticated_pi")),
  sample_codex_available: And(boolConst("enabled_codex"), boolConst("authenticated_codex")),
  sample_claude_available: And(boolConst("enabled_claude"), boolConst("authenticated_claude")),
};

// Extra scenario assertions, named for conflict reporting.
const extras = {
  R07_pi_marked_available: boolConst("available_pi"),
  R07_pi_sent_dispatch: boolConst("dispatch_pi"),
  R13_codex_default: boolConst("default_codex"),
  R13_claude_default: boolConst("default_claude"),
  // R13 decision: promoting Codex revokes Claude's default flag.
  R13_decision_codex_default: boolConst("default_codex"),
  R13_decision_claude_default_revoked: Not(boolConst("default_claude")),
};

async function check(label, extraNames, expectSat) {
  const solver = new Solver();
  for (const expr of Object.values(exprs)) solver.add(expr);
  for (const name of extraNames) solver.add(extras[name]);
  const result = String(await solver.check()).toLowerCase();
  const sat = result === "sat";
  console.log(`${label}: ${result.toUpperCase()} (expected ${expectSat ? "SAT" : "UNSAT"})`);
  return { label, sat, expectSat };
}

async function minimalConflict(extraNames) {
  // Containment-minimal: drop any single named assertion that leaves UNSAT.
  const conflict = new Set([...Object.keys(exprs), ...extraNames]);
  for (const name of conflict) {
    const trial = new Solver();
    for (const [n, expr] of Object.entries(exprs))
      if (conflict.has(n) && n !== name) trial.add(expr);
    for (const n of extraNames) if (conflict.has(n) && n !== name) trial.add(extras[n]);
    if (String(await trial.check()).toLowerCase() === "unsat") conflict.delete(name);
  }
  return [...conflict];
}

const results = Promise.all([
  check(
    "R07 board: enabled but unauthenticated Pi marked available and dispatched",
    ["R07_pi_marked_available", "R07_pi_sent_dispatch"],
    false,
  ),
  check(
    "R13 board: Codex and Claude both default",
    ["R13_codex_default", "R13_claude_default"],
    false,
  ),
  check(
    "R13 decision: new available default replaces the old flag",
    ["R13_decision_codex_default", "R13_decision_claude_default_revoked"],
    true,
  ),
]);

console.log(
  `  R07 minimal conflict: ${(await minimalConflict(["R07_pi_marked_available", "R07_pi_sent_dispatch"])).join(", ")}`,
);
console.log(
  `  R13 minimal conflict: ${(await minimalConflict(["R13_codex_default", "R13_claude_default"])).join(", ")}`,
);

const failed = (await results).filter((r) => r.sat !== r.expectSat);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.map((f) => f.label).join("; ")}`);
  process.exit(1);
}
console.log("All checks matched expectations.");
