# Coding Standards

Judgement standards for code reviews in this repository. Consulted by the review agent.

## Module Interfaces & Simplicity

- **Deep, Focused Interfaces**: Keep function signatures lean and explicit. Avoid speculative generality, defensive argument sniffing (e.g. `typeof arg === 'function'`), or unused option flags.
- **Event Delegation Over Per-Element Listeners**: Use container delegation for repetitive list items (such as `#itemList`) rather than binding redundant click listeners to individual card roots.
- **Explicit Event Isolation**: Interactive sub-elements within delegated containers (e.g. Tag chips in item cards) must explicitly stop propagation (`e.stopPropagation()`) to prevent unintended container trigger actions.

## Test Architecture & Performance

- **Fixture I/O Hygiene**: Load and cache static templates (such as `sidebar.html`) once at the test module or suite scope instead of re-reading them inside individual `it(...)` blocks.
- **Pure Behavioral Assertions**: Assert external behaviors (rendered DOM elements, emitted storage events, navigation calls) rather than testing internal private variables or redundant parameter permutations.

## Domain Language Integrity

- Use terms from [GLOSSARY.md](GLOSSARY.md) across code symbols, test descriptions, comments, and commit messages.
