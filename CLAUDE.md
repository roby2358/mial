# CLAUDE.md

MIAL (MarkdownIsALisp) as a library in JS, TS, Python and Rust. ONTOLOGY.md is the implementation reference. Cite stable IDs (G-n, D-n, Q-n, R-n), never section numbers.

## Commands

- `just test`: all four languages against the shared corpus. Also `just test-js`, `test-ts`, `test-python`, `test-rust`.
- `just cc-matrix`: regenerate the R-33 golden matrix from `js/mial.js`. Review the diff.
- `just cc-depth`: measure JS stack headroom against `DEPTH_LIMIT`.

## Rules

- G-1 is the point: the same MIAL gives the same value, log, diagnostics and error text everywhere. A semantic change touches all four libraries in one change.
- `js/` is hand-written with no build step, and must stay loadable by a plain script tag. It isn't generated from `ts/` (D-3).
- Add behaviour tests as cases in `test/R-n/` (`name.md` plus `name.json`), not in a language's own test directory, and write expected values from the ontology, not from output. Language runners stay thin, with no skip lists.
- BuildLife and yuwakisaweb are reference only. No back-porting and no compatibility with their programs (D-1).
- No host value (`undefined`, `NaN`, Infinity) or host error text may reach MIAL (G-2).
- Changing a rule or number: update ONTOLOGY, RATIONALE, CRITERIA and the corpus together, and add a dated ARCHITECTURE_LOG entry.
