---
name: mial-dev
description: Project recipes for MIAL development. Use when regenerating the R-33 matrix or checking DEPTH_LIMIT against the JS stack.
---

# MIAL recipes

- `just cc-matrix`: regenerates `test/R-33/matrix.{md,json}` from `js/mial.js` after a deliberate semantic change. Review the diff, then run `just test`; the other three languages must agree.
- `just cc-depth`: reports the depth each JS call shape survives on a default V8 stack. `DEPTH_LIMIT` must stay below the lowest number with margin. A new built-in that calls back into MIAL may need a new shape here and in `test/R-25/`.
