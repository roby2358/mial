# ARCHITECTURE LOG

Newest first.

### 2026-11-06 — Code reviewed against ONTOLOGY; four divergences fixed
**Records.** The code tested only for the value `record`, so `keys` on `` - record `1` `` built a string around a raw number in JS and crashed on `show`, while the other languages returned `"1"`. All four now test the ONTOLOGY shape, and anything else is a tree. This changes a pinned case: R-31 `q-record` read a valueless `- b` field as null, and now spells out `` - b `null` ``.

**`put` on repeated keys.** JS, TS and Python replaced every match and Rust only the first. All now replace every match (D-28).

**Non-finite numbers from hosts.** `num` accepted NaN and infinities, breaking the finite-numbers invariant: Rust panicked formatting one. It now returns an error node (D-30). Python's `from_plain` also let a non-string key through as a Value, and now raises.

**`deserialize`.** Extra keys and lone surrogates gave different results by host, and are now malformed everywhere (D-29).

Smaller alignments: Rust's `ctx.log_line` is now `ctx.log` as the interface states, JS `load` throws on a missing field instead of running with no limit, and a thrown non-`Error` in JS and TS reports its text rather than `undefined`. ONTOLOGY now states the `let` error text, `format` of a closure, `toPlain` of a builtin, the type-name of a fieldless Record and Rust's `EvalResult`, all already true of the code. The R-33 golden is unchanged.

### 2026-11-06 — MIT license stated, repo pushed to GitHub, history moved out of current-state docs
Pushed to `github.com/roby2358/mial`, under the MIT license already in `LICENSE` and the four manifests, and noted in the README. Package registries stay a non-goal (D-5). `pjpd/bak/` is ignored, since tracker backups aren't source.

Reworded RATIONALE to describe the current state, moving the story here: non-empty lists were falsy because truthiness checked only a node's label (D-18). `cons x null` giving `(x null)`, and `cdr` returning a bare second child, were leftovers of an earlier pair representation (D-20). D-10's title changed from "Code constants removed" to "No code-constant definition form". ONTOLOGY now states the exact `lambda` and `mial-of` error text that R-10 and R-19 already test. The README no longer uses `../` paths, which mean nothing on GitHub. No behaviour changed.

### 2026-11-06 — Open questions settled; `mial` ignores extra children
Q-1 settled by D-25: `mial` returns its first child and ignores the rest, replacing the "takes exactly one child" error. A childless `mial` is unchanged: it's a variable lookup and never reached that error, which R-8 now pins. Q-2 settled by D-26: no literal escape syntax for now. Q-3 settled by D-27: data lists keep rendering as siblings. R-8 updated, and the R-33 golden regenerated.

### 2026-11-05 — Project created: MIAL as a four-language library
Extracted from `../yuwakisaweb/markdown_is_a_lisp/interpreter.js` and its extended copy `../buildlife/js/mial.js`, as a new forward-looking language that doesn't back-port to either.

Changes from those sources: strict types and finite numbers replaced JS coercion (D-6). `and`/`or` became short-circuit special forms (D-7). Exact-arg tolerance became must-ignore shaping for all calls (D-8). Added `call` (D-9). Removed the code-constant definition form (D-10). The step budget moved from a module global to per-interpreter, and host stack-overflow handling became a counted depth limit (D-11). `length` moved from UTF-16 units to code points (D-12). Fixed lambda rendering (D-13). Added the sibling-param diagnostic (D-14).

Also changed on Claude's proposal, pending review: lone `*` spec (D-15), `*`-only multi-param head (D-16), `error?` as a special form (D-17), truthiness of non-empty lists (D-18), deep `eq` (D-19), `cons`/`cdr` list laws (D-20), ASCII source whitespace (D-21), empty-definition diagnostic (D-22), and the `# main` runner reduced to `run()` (D-24). Crash text from host engines is gone from the language.

`DEPTH_LIMIT` was first set by estimate and lowered the same day after `just cc-depth` showed `reduce` through `call` overflows V8 first (D-11).

The BuildLife default world was considered as a test fixture and dropped once code constants were removed; BuildLife stays reference only.
