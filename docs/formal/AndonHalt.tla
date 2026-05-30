------------------------ MODULE AndonHalt -------------------------
(**
 * Formal TLA+ specification of the Andon Halt-Resume state machine.
 *
 * Wave-138 — Formal Model Checking (TLA+)
 * Source-of-truth implementation files:
 *   scripts/andon-halt-helpers.mjs  (Halt, QueueHalt transitions)
 *   scripts/andon-resume.mjs        (Resume, ForceResume, PromoteQueue transitions)
 *   scripts/run-verification-pipeline.mjs  (pipeline gate / soft-mode bypass)
 *
 * ARCHITECTURE NOTE:
 * The halt-state sentinel has two fields:
 *   active  -- the currently-blocking halt record (null when clear)
 *   queue   -- ordered list of pending halt records
 *
 * This spec models all observable states and every transition the real code
 * performs, INCLUDING the ForceResume escape hatch and the soft-mode bypass.
 * Omitting either would overstate the safety guarantee.
 *
 * State encoding:
 *   RUNNING   -- active = null, queue = empty, enabled = any
 *   HALTED    -- active != null, queue = empty, enabled = TRUE
 *   QUEUED    -- active != null, queue non-empty, enabled = TRUE
 *   SOFTMODE  -- active != null (any queue), enabled = FALSE
 *                (pipeline gate does NOT block — run-verification-pipeline.mjs:83-90)
 *)

EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  MaxQueue,   \* state-space bound: max items ever in queue (TLC: set to 2)
  Agents      \* finite set of agent names (TLC: {"agent1", "agent2"})

VARIABLES
  active,     \* NULL or a halt record (modelled as TRUE/FALSE for state-space)
  queue,      \* sequence of queued halts (length bounded by MaxQueue)
  enabled,    \* BOOLEAN — mirrors andonCord.enabled in .sdd-config.json
  lastAction  \* last action taken (for trace readability)

NULL == "NULL"  \* sentinel for "no active halt"

(* -----------------------------------------------------------------------
   Type invariant
   ----------------------------------------------------------------------- *)
TypeOK ==
  /\ active \in {NULL} \cup {"halt_record"}
  /\ queue \in Seq({"halt_record"})
  /\ Len(queue) <= MaxQueue
  /\ enabled \in BOOLEAN
  /\ lastAction \in {"INIT", "Halt", "QueueHalt", "Resume",
                     "ForceResume", "PromoteQueue"}

(* -----------------------------------------------------------------------
   Derived state predicates (spec §1 state definitions)
   ----------------------------------------------------------------------- *)
IsRunning  == active = NULL
IsHalted   == active # NULL /\ enabled = TRUE /\ Len(queue) = 0
IsQueued   == active # NULL /\ enabled = TRUE /\ Len(queue) > 0
IsSoftMode == active # NULL /\ enabled = FALSE

(* -----------------------------------------------------------------------
   Initial state
   ----------------------------------------------------------------------- *)
Init ==
  /\ active   = NULL
  /\ queue    = <<>>
  /\ enabled  \in BOOLEAN    \* model both soft-mode and hard-mode from start
  /\ lastAction = "INIT"

(* -----------------------------------------------------------------------
   Transition: Halt
   Models: andon-halt-helpers.mjs:112-170 (writeHaltState — no active halt)
   Precondition: active = NULL  (no existing active halt)
   Effect: active becomes a halt record; exits with code 42
   ----------------------------------------------------------------------- *)
Halt ==
  /\ active = NULL
  /\ active' = "halt_record"
  /\ queue'  = <<>>
  /\ enabled' = enabled
  /\ lastAction' = "Halt"

(* -----------------------------------------------------------------------
   Transition: QueueHalt
   Models: andon-halt-helpers.mjs:128-133 (concurrent halt while one is active)
   Precondition: active != NULL AND Len(queue) < MaxQueue
   Effect: new halt appended to queue; active unchanged
   ----------------------------------------------------------------------- *)
QueueHalt ==
  /\ active # NULL
  /\ Len(queue) < MaxQueue
  /\ active'  = active
  /\ queue'   = Append(queue, "halt_record")
  /\ enabled' = enabled
  /\ lastAction' = "QueueHalt"

(* -----------------------------------------------------------------------
   Transition: Resume
   Models: andon-resume.mjs:164-171 (field-validated resume)
   Precondition: active != NULL
   Human-gate: requires --approver, --reason, --root-cause each >= 10 chars.
   In the model we represent "human provided valid fields" as the precondition
   being enabled (the human chose to invoke Resume, not ForceResume).
   Effect: if queue empty -> active = NULL (RUNNING);
           if queue non-empty -> PromoteQueue fires instead (see PromoteQueue)
   NOTE: When queue is non-empty, Resume logs RESUME and then calls
         PromoteQueue logic (andon-resume.mjs:188-208). We model this as
         Resume-then-PromoteQueue being a two-step sequence for clarity,
         but also provide a combined variant below.
   ----------------------------------------------------------------------- *)
Resume ==
  /\ active # NULL
  /\ Len(queue) = 0
  /\ active'  = NULL
  /\ queue'   = <<>>
  /\ enabled' = enabled
  /\ lastAction' = "Resume"

(* -----------------------------------------------------------------------
   Transition: ResumeWithQueue
   Models: andon-resume.mjs:188-208 combined with field-validated resume
   when queue is non-empty.
   Effect: queue[0] promoted to active; remaining queue preserved.
   ----------------------------------------------------------------------- *)
ResumeWithQueue ==
  /\ active # NULL
  /\ Len(queue) > 0
  /\ active'  = Head(queue)
  /\ queue'   = Tail(queue)
  /\ enabled' = enabled
  /\ lastAction' = "PromoteQueue"

(* -----------------------------------------------------------------------
   Transition: ForceResume (escape hatch)
   Models: andon-resume.mjs:147-162 (--force-clear path)
   This is the NAMED escape hatch that bypasses approver field validation.
   It calls fs.unlinkSync(.sdd-halt-state.json) directly and logs
   event: 'FORCED_RESUME' with approver: null.
   This is NOT a violation of NoAutoResume — it is a distinct, auditable
   action that logs FORCED_RESUME to halt-events.jsonl.
   A hidden auto-clear (no action) is what NoAutoResume prohibits.
   Precondition: active != NULL (halt exists to clear)
   Effect: active cleared to NULL (RUNNING); queue discarded.
           Real code: fs.unlinkSync deletes entire sentinel file,
           so any queued halts are also cleared by force.
   Reference: andon-resume.mjs:147-162 — "force-clear flag used —
              field validation skipped", approver: null, FORCED_RESUME logged
   ----------------------------------------------------------------------- *)
ForceResume ==
  /\ active # NULL
  /\ active'  = NULL
  /\ queue'   = <<>>      \* force-clear deletes the entire sentinel file
  /\ enabled' = enabled
  /\ lastAction' = "ForceResume"

(* -----------------------------------------------------------------------
   Transition: ToggleSoftMode
   Models: .sdd-config.json andonCord.enabled field being changed by operator.
   This is an environment action, not an agent action. Enables the model
   to explore both soft-mode and hard-mode paths from any state.
   ----------------------------------------------------------------------- *)
ToggleSoftMode ==
  /\ enabled' = ~enabled
  /\ active'  = active
  /\ queue'   = queue
  /\ lastAction' = lastAction

(* -----------------------------------------------------------------------
   Next-state relation
   ----------------------------------------------------------------------- *)
Next ==
  \/ Halt
  \/ QueueHalt
  \/ Resume
  \/ ResumeWithQueue
  \/ ForceResume
  \/ ToggleSoftMode

(* -----------------------------------------------------------------------
   Fairness spec (required for liveness AlwaysEventuallyResumable)
   Weak fairness on Resume and ForceResume: if either is continuously
   enabled, it must eventually fire. This models "a human will eventually
   act" — the minimal liveness assumption for a human-gated system.
   ----------------------------------------------------------------------- *)
Fairness ==
  /\ WF_<<active, queue, enabled, lastAction>>(Resume)
  /\ WF_<<active, queue, enabled, lastAction>>(ResumeWithQueue)
  /\ WF_<<active, queue, enabled, lastAction>>(ForceResume)

Spec == Init /\ [][Next]_<<active, queue, enabled, lastAction>> /\ Fairness

(* =======================================================================
   SAFETY INVARIANTS
   ======================================================================= *)

(* -----------------------------------------------------------------------
   NoAutoResume
   The active halt field clears ONLY via:
     (a) Resume — human-approved (approver + reason + root-cause >= 10 chars)
         modelled as the Resume or ResumeWithQueue transition
     (b) ForceResume — named escape hatch (no approver, FORCED_RESUME logged)
         modelled as the ForceResume transition; andon-resume.mjs:147-162
   A state where active spontaneously becomes NULL without either action
   is unreachable. This invariant checks the last-action constraint:
   if active just became NULL, the action must have been Resume or ForceResume.
   In TLA+ we encode this as: whenever active = NULL, the prior step
   was a clearing action (lastAction in {"Resume", "PromoteQueue", "ForceResume",
   "INIT"}). INIT is the initial state (no halt ever existed).
   NOTE: ForceResume is the named escape hatch — it is NOT a violation.
   The honest scope of this invariant is "no SILENT auto-clear."
   ----------------------------------------------------------------------- *)
NoAutoResume ==
  active = NULL =>
    lastAction \in {"INIT", "Resume", "PromoteQueue", "ForceResume"}

(* -----------------------------------------------------------------------
   ExitBlocksWhenEnabled
   Models: run-verification-pipeline.mjs:58-92
   When andonCord.enabled = TRUE and active != NULL, the pipeline is blocked
   (exit-42). In the model: no RUNNING state is reachable with enabled=TRUE
   except through a proper Resume or ForceResume.
   The SOFTMODE path (enabled=FALSE) is the named bypass — pipeline continues.
   ----------------------------------------------------------------------- *)
ExitBlocksWhenEnabled ==
  (active # NULL /\ enabled = TRUE) =>
    lastAction \in {"Halt", "QueueHalt", "PromoteQueue"}

(* =======================================================================
   LIVENESS PROPERTY
   ======================================================================= *)

(* -----------------------------------------------------------------------
   AlwaysEventuallyResumable
   A machine in HALTED or QUEUED state can always eventually reach RUNNING.
   Requires the fairness assumptions in Spec (WF on Resume and ForceResume).
   This models: a HALTED machine is never permanently stuck — either a human
   approves the resume, or an operator uses force-clear.
   The property is: [] (active # NULL => <> (active = NULL))
   i.e., any halt is eventually cleared.
   ----------------------------------------------------------------------- *)
AlwaysEventuallyResumable ==
  [](active # NULL => <>(active = NULL))

====================================================================
