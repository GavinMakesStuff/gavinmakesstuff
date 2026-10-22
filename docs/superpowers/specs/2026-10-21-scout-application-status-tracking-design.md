# Scout: application status tracking (Applied tab)

Date: 2026-10-21. Status: draft, awaiting user review.

## Goal
Let the user track where each applied job stands, in three tiers, and fix any
entry at any time if they made a mistake.

## Data model
Stored inside each applied job's existing `job_data` jsonb (same place as
`dateApplied`, `notes`, `followUpSent`). No migration, no new table, no RLS or
grant changes.

| Field | Values |
|---|---|
| `appStatus` | `pending` (default), `interview_scheduled` |
| `interviews` | array, max 10: `{ date: 'YYYY-MM-DD' or '', completed: boolean }` |
| `finalDecision` | `''` (none), `cancelled`, `rejected`, `offer_received`, `offer_rejected`, `offer_accepted` |

Rejected is a single value. Tier 1 "Rejected" and Tier 3 "Application Rejected"
both read and write `finalDecision = 'rejected'`. Choosing Pending or Interview
Scheduled in Tier 1 while `finalDecision === 'rejected'` clears it back to none.
Existing jobs with none of these fields behave as `pending`, no interviews, no
final decision.

## Tiers
**Tier 1 (always shown on applied cards):** dropdown: Pending, Rejected,
Interview Scheduled.
- Interview Scheduled shows a date input and an "Interview completed" checkbox.
  The date and checkbox are Interview 1 in the `interviews` array (created on
  first use).

**Tier 2 (interviews):** shown when any interview has a date on or before today,
or any interview is marked completed. Evaluated at render time, no timers.
- One row per interview ("Interview 1" .. "Interview 10"): date input,
  Scheduled/Completed toggle, remove button (confirm before deleting).
- "Add interview" button, hidden at 10.

**Tier 3 (final decision, always shown):** dropdown: None, Application Cancelled,
Application Rejected, Offer Received, Offer Rejected, Offer Accepted.

## Editability rule (required)
Every control can be changed, reverted, or cleared at any time.
- Changing one tier never deletes another tier's data. Setting Tier 1 back to
  Pending keeps `interviews`; clearing `finalDecision` keeps everything else.
- Only deletion: the explicit per-interview remove button, with confirmation.
- Tier 2 hides again if the value that revealed it is corrected; its data stays.
- A manual "Add interview" link is always available in the status block so an
  interview can be logged without going through Tier 1.
- The card badge always reflects current values.

## Card badge
One badge on the collapsed card header. Priority: final decision, then the
latest interview state (e.g. "Interview 2 scheduled"), then Tier 1 value.

## Code touch points (scout/js/jobs.js, scout/app.html)
- New status block at the top of "Application Tracking" in `renderSavedCard`
  (~line 1160), rendered only when `isApplied`.
- Badge in the card header (~line 1053).
- Handlers beside `updateTracking` (~line 1534): set status, set/add/remove
  interview, set final decision; each calls `syncAppliedJobs()` and re-renders.
- Add the three fields to the places that copy tracking fields by name:
  re-analysis (~line 1437) and move-back-to-saved (~line 1465).
- `markApplied` / `markAppliedFromSaved` (~lines 1324, 1338): initialize
  `appStatus: 'pending'`.
- "Copy full details" text (~line 1680): add a status line.
- Small CSS block in app.html using existing teal/sand variables.

## Testing
- `node --check scout/js/jobs.js`.
- Browser check on a real applied job: each tier change, Tier 2 reveal by past
  date and by completed, 10-interview cap, rejected sync between tiers, clearing
  and reverting every control, persistence across reload.

## Out of scope
History/audit log, reminders or notifications for upcoming interviews,
reporting by status.

## Amendments made during planning (2026-10-21)
- Logic and markup live in a new file, `scout/js/app-status.js` (global `AppStatus`), with node tests in `scout/tests/app-status.test.js`, instead of growing the ~1,800-line `jobs.js`. `jobs.js` only holds thin handlers.
- Added a boolean `interviewsOpen`, set when the user clicks "Add interview". Without it, a manually added interview with no date would stay hidden. Tier 2 shows when it is true, or when any interview is completed or due. Once set it stays set, so Tier 2 no longer hides itself via the date/completed rule after a manual add (removing every interview does not hide it).
- `markApplied` / `markAppliedFromSaved` are not changed: missing fields already mean pending / none.
- The status block is its own "Application Status" section directly above "Application Tracking", not inside the tracking box.
- The badge appears in the card header (cards are not collapsible).
- Re-analysis of a saved job preserves the status fields, so moving a job back to saved and re-analyzing does not lose them.
