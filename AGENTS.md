## Agent Guidance

### Issue tracker

Track specs and tasks in GitHub Issues (`0oWoodenDooro0/extension`) via `gh` CLI.

### Domain docs

Read `GLOSSARY.md` and relevant `docs/adr/` before modifying domain logic or introducing terms. Use glossary terms consistently and surface any contradiction with an existing ADR explicitly.

### Coding standards

Consult `CODING_STANDARDS.md` during code review for non-mechanical judgment calls.

### Verification

Run `npm run check` (`eslint .` + Node tests with 1s timeout and fetch guardrail; matches CI).
