## Agent Guidance

### Architecture

- `sidebar/`: Side panel views (`itemsView.js`, `manageTagsView.js`), local store, sync coordinator.
- `popup/`: Search shortcut popup interface.
- `background.js`: Service worker (context menus, tab image fetching, quick save).
- `tabAdapter.js`: Tab operations and navigation (`openAdjacent`).
- `tests/`: Node test runner suites (`npm test`).

### Issue tracker

Track specs and tasks in GitHub Issues (`0oWoodenDooro0/extension`) via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context glossary (`GLOSSARY.md`) and architectural decisions (`docs/adr/`). See `docs/agents/domain.md`.

### Coding standards

Consult `CODING_STANDARDS.md` during code review for non-mechanical judgment calls.

### Remediation

Edit small review findings (≤2 files, vocabulary fixes, dead code removal) directly. Do not spawn child delegates or worktrees for them.

### Verification

Run `npm run check` (`npm run lint` and `npm test` with network guardrail and 1s timeout).
