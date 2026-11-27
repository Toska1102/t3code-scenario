# Ticket 03 pre-code SMT evidence

Named-assertion Z3 check for the Agent connection dialog, run before any
implementation code. Solver: z3-solver (Z3 4.13.x) via
`/tmp/workbench-smt.l3An1x/node_modules/z3-solver`; script:
[ticket-03-agents.mjs](smt/ticket-03-agents.mjs).

```
R07 board: enabled but unauthenticated Pi marked available and dispatched: UNSAT (expected UNSAT)
R13 board: Codex and Claude both default: UNSAT (expected UNSAT)
R13 decision: new available default replaces the old flag: SAT (expected SAT)
  R07 minimal conflict: R07_available_iff_enabled_and_authenticated, R07_pi_not_authenticated, R07_pi_marked_available
  R13 minimal conflict: R13_at_most_one_default, R13_codex_default, R13_claude_default
All checks matched expectations.
```

Reading:

- **R07** — enabling an instance must not make it available. Availability is
  `enabled ∧ authenticated`. The minimal conflict drops the availability rule
  itself, not the enablement flag, so the UI must show 启用、认证、可用 as three
  separate states (the dialog header shows the 需要认证 badge next to an active
  启用 switch, exactly board 05.01).
- **R13** — two defaults on one device is UNSAT; promoting a new available
  instance replaces the previous default flag (SAT with
  `claude_default_revoked`). Default selection and the availability count stay
  independent.
- **R09** (modeled as a free boolean, SAT): a started step continues on its
  snapshot while the disabled instance stops accepting new dispatches. The
  enforcement point is the dispatch/runtime layer (later ticket); this dialog
  only flips the flag and reports reference impact.
