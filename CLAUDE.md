@AGENTS.md

# College Compass — project notes

- Product spec: https://claude.ai/code/artifact/2baea690-7a5a-46c8-8265-f9d1f448aabd
- Users are minors (grades 7–12, some under 13). Privacy and safety rules are product
  requirements, not polish:
  - Never send names, emails, usernames or birth dates to the AI provider. Build prompts from
    `StudentAiContext` and run free text through `scrubPii`.
  - Every student message to an AI feature goes through `assessMessage` first.
  - Audit metadata must never contain personal data (it outlives deletion).
  - New student data must be covered by `exportStudentData` and deleted with the student.
- Business logic lives in `src/lib` as functions taking a `Db`; server actions stay thin.
  Test with `createTestDb()` (fresh in-memory PGlite per test).
- Authorization happens in the data-access layer (`requireUser`, ownership checks), never only
  in `src/proxy.ts`.
- Forms use `useFormAction` so values survive validation errors (React resets forms after actions).
- AI calls: structured outputs via `messages.create` with `betaZodOutputFormat`, read with
  `readStructuredOutput` after recording usage with `recordMessageUsage` (a response with no usable
  output is still billed; `parse` would throw first). Check `assertWithinBudget` before non-safety
  calls. Safety checks are never budget-blocked.
- Safety keyword rules rated high/imminent override the model, so they only hold unambiguous
  phrasings; ambiguous slang stays medium. Pin every rule change in `rules.test.ts` (must-catch and
  must-not-flag tables) and check the eval set: no case expected below high may rate high.
- After changing `src/db/schema.ts`, run `npm run db:generate` and commit the migration.
- Assessment items are licensed: O*NET Interest Profiler items are CC BY-ND (use verbatim, keep the
  attribution); Mini-IPIP items are public domain. Scoring is code, never the model.
- Student tables store occupation codes without foreign keys to reference tables, so
  `npm run data:load` (which replaces reference tables) never deletes student data.
- After changing matching, run `npm run check:matching` (needs `npm run data:load` first).
