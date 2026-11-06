# ARCHITECTURE LOG

Newest first.

### 2026-11-06 — Open questions settled; `mial` ignores extra children
Q-1 settled by D-25: `mial` returns its first child and ignores the rest, replacing the "takes exactly one child" error. A childless `mial` is unchanged: it's a variable lookup and never reached that error, which R-8 now pins. Q-2 settled by D-26: no literal escape syntax for now. Q-3 settled by D-27: data lists keep rendering as siblings. R-8 updated, and the R-33 golden regenerated.

### 2026-11-05 — Project created: MIAL as a four-language library
Extracted from `../yuwakisaweb/markdown_is_a_lisp/interpreter.js` and its extended copy `../buildlife/js/mial.js`, as a new forward-looking language that doesn't back-port to either.

Changes from those sources: strict types and finite numbers replaced JS coercion (D-6). `and`/`or` became short-circuit special forms (D-7). Exact-arg tolerance became must-ignore shaping for all calls (D-8). Added `call` (D-9). Removed the code-constant definition form (D-10). The step budget moved from a module global to per-interpreter, and host stack-overflow handling became a counted depth limit (D-11). `length` moved from UTF-16 units to code points (D-12). Fixed lambda rendering (D-13). Added the sibling-param diagnostic (D-14).

Also changed on Claude's proposal, pending review: lone `*` spec (D-15), `*`-only multi-param head (D-16), `error?` as a special form (D-17), truthiness of non-empty lists (D-18), deep `eq` (D-19), `cons`/`cdr` list laws (D-20), ASCII source whitespace (D-21), empty-definition diagnostic (D-22), and the `# main` runner reduced to `run()` (D-24). Crash text from host engines is gone from the language.

`DEPTH_LIMIT` was first set by estimate and lowered the same day after `just cc-depth` showed `reduce` through `call` overflows V8 first (D-11).

The BuildLife default world was considered as a test fixture and dropped once code constants were removed; BuildLife stays reference only.
