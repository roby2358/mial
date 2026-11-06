# RATIONALE

Why each current choice stands. Decisions are numbered permanently.

## Scope

### D-1 A new language, not a port — *Decided*
- **Alternatives:** faithfully extract BuildLife's `mial.js`; keep compatibility as a constraint.
- **Why:** G-5. The designer's direction: both earlier projects are source and inspiration, nothing is back-ported, and this is for the next application. It's what permits the stricter semantics below.

### D-2 A core language plus an opt-in host library — *Decided*
- **Alternatives:** one flat set of built-ins; the original language only.
- **Why:** G-4. Records, lists, numbers and text proved necessary in practice, but a host may want a smaller surface. Libraries also give hosts one way to add capability, the same way the shipped ones do.

### D-3 Four independent implementations; `js/` and `ts/` are separate hand-written copies — *Decided*
- **Alternatives:** TS source compiled to JS (no drift, but a build step); JS plus `.d.ts` only.
- **Why:** the designer wants `js/` buildless. The shared corpus is the only guard against drift, which makes R-33 (the matrix) important.

### D-4 One shared corpus in `test/`, run by a thin runner per language — *Proposed*
- **Alternatives:** per-language suites; one language as a live oracle.
- **Why:** G-1. A case is a real `.md` MIAL file plus a `.json` of expected results, and no language has privileged access to them. Results are compared as `show` text, which is exact and readable.

### D-5 Packaging: dual-mode script, local packages — *Decided*
- **Alternatives:** ES modules for `js/`; publish-ready metadata.
- **Why:** `js/mial.js` works from a script tag on `file://`, and from `require`. No publishing yet.

## Semantics

### D-6 Strict types; finite numbers only — *Decided*
- **Alternatives:** port JS coercion (`+ null 1` is 1, `<= "a" "b"` is true); exact JS emulation; strict types with IEEE NaN and Infinity.
- **Why:** G-1, G-2. Coercion tables differ per host and hide bugs, and NaN and Infinity render and serialize badly. Comparing only what's meaningful leaves little to port wrongly.
- **Evidence:** `+` joining strings and numbers stays because real prompt-building code needs it. Measured by a probe of BuildLife's default world over 4000 ticks: joins were common, while null in arithmetic appeared only through one `and` guard (see D-7).

### D-7 `and` / `or` short-circuit, as special forms — *Decided*
- **Alternatives:** eager functions; allow null in ordering.
- **Why:** `and (!= seen null) (> edits seen)` is the natural way to write a guard. Under strict typing an eager `and` makes it an error. The cost is that they can't be passed as values.

### D-8 Must-ignore arguments: extra ignored, missing null — *Decided*
- **Alternatives:** exact-arity errors; error on missing only.
- **Why:** the designer's call. One predictable rule across closures, builtins and host calls. Under strict types, a missing number still fails loudly at the operation that needed it. `- ` and `/` with no args therefore need no special case.
- **Consequence:** `Fixed` and `Variadic` arity are declared with each builtin, so shaping lives in one place.

### D-9 `call` special form for zero-arg functions and computed operators — *Decided*
- **Alternatives:** auto-call on reference (can't pass the function as a value; `mial-of` must become special); `f()` token (a new token rule, and the tree needs a marker beyond `{value, children}`).
- **Why:** G-3. No new syntax or node shape, it round-trips, and it also reaches zero-arg `+`.

### D-10 Code constants removed — *Decided*
- **Alternatives:** keep the single-`mial`-child binding form.
- **Why:** `mial-of` plus `call` cover it, with one definition rule fewer. A heading over `- mial` is now just a function returning the tree.

### D-11 Explicit step and depth limits counted in MIAL terms — *Proposed, tuned by R-24, R-25*
- **Alternatives:** catch host stack overflow (JS `RangeError`, Python `RecursionError`; Rust aborts the process, and every host would fail at a different depth).
- **Why:** G-1, G-2. Only a counted depth gives the same outcome everywhere.
- **Evidence:** `DEPTH_LIMIT` is capped by the smallest default host stack, which is V8's. Measured by `just cc-depth` on Node 26: plain recursion survives to 1807, `reduce` through `call` (the worst shape found) only to 1318. The limit keeps margin below that, and R-25 runs the worst shape at the default limit. Other browsers' stacks are unmeasured.
- **Cost:** simple recursion uses two evaluations per level, so about 500 levels by default. Hosts can pass a higher limit if their stack allows.
- **Python and Rust:** Python raises its recursion limit for the duration of a call. Rust uses `stacker` to grow its stack, which keeps `Rc`-based values on one thread.

### D-12 `length` counts Unicode code points — *Decided*
- **Alternatives:** UTF-16 units (JS native only); graphemes (needs segmentation data, and changes with Unicode versions).
- **Why:** G-1. Available exactly in all hosts without dependencies.

### D-13 Lambda renders with the `*` spec — *Decided*
- **Why:** G-3. Sibling bullets re-parse as a different function. Closures now render through their `lambda` form, so `print-mial` round-trips.

### D-14 Diagnostic for discarded bare symbols after a spec — *Decided*
- **Alternatives:** make sibling bullets a legal multi-param spec.
- **Why:** `- a`, `- b`, `- + a b` silently meant one param. Parsing keeps one rule; the diagnostic catches the mistake. A sole bare body (`- x`, `- x`, the identity function) produces no diagnostic because its value is used.

### D-15 Lone `*` is an empty parameter spec — *Proposed*
- **Alternatives:** no zero-param `lambda`; a dedicated keyword.
- **Why:** `call` makes zero-arg lambdas useful and they need to render. `*` is already the multi-param head.

### D-16 Multi-param spec head must be `*` — *Proposed*
- **Alternatives:** any head with symbol children counts as a spec.
- **Why:** G-2. `# f`, `- g x`, `- h x` was silently a one-param function with `g` ignored. The same class of trap as D-14.

### D-17 `error?` is a special form — *Proposed*
- **Alternatives:** leave it as a function; add `try`.
- **Why:** as a function its argument's error propagates before the call, so it could never return true. Limit aborts stay uncatchable so a runaway can't swallow its own limit.

### D-18 Truthiness ignores nothing but childless false, null, 0 — *Proposed*
- **Alternatives:** check only the label, which makes a non-empty data list falsy.
- **Why:** G-2. A non-empty list being falsy was an accident of the representation.

### D-19 Deep structural `eq` — *Proposed*
- **Alternatives:** label comparison, which says `(1)` equals `(2)` because both lists have null labels.
- **Why:** G-2. Label comparison gives wrong answers without any error.

### D-20 `cons x null` is `(x)`; `cdr` always returns a list — *Proposed*
- **Alternatives:** `cons x null` is `(x null)`, and `cdr` returns a bare second child for two-child trees.
- **Why:** both were leftovers of an earlier pair representation, and neither obeys the Lisp list laws the docs promise.

### D-21 Source whitespace is space, tab and CR only — *Proposed*
- **Why:** G-1. JS `trim`, Python `strip` and Rust `trim` disagree on Unicode whitespace.

### D-22 Empty definitions produce a diagnostic — *Proposed*
- **Why:** the "nothing malformed is dropped silently" invariant.

### D-23 Serialization is byte-exact across languages — *Proposed*
- **Why:** G-1, G-4. State saved by one host loads in another. Keys and escaping are fixed so saved files compare equal.
- **Evidence:** R-32 found two `serde_json` defaults that break this: inexact float parsing (fixed with `float_roundtrip`) and a 128-level depth limit (fixed with `unbounded_depth`).

### D-24 `run()` is only `call("main", [])` — *Proposed*
- **Alternatives:** the original runner, which logged warnings and an end banner.
- **Why:** banners belong to a UI. Hosts read `diagnostics` directly.

### D-25 `mial` uses its first child and ignores the rest — *Decided*
- **Alternatives:** error on extra children; quote them all as a list.
- **Why:** the designer's call. It extends D-8: unreachable lines at the end of a `mial` are ignored, not an error. The cost is that a quoted line left over by mistake gets no error or diagnostic.
- **Consequence:** a bare `- mial` isn't a quote at all. Like any childless symbol it's a variable lookup, so it gives `mial: undefined symbol`.

### D-26 No literal escape syntax for now — *Decided*
- **Alternatives:** add `\``-style escapes.
- **Why:** the designer's call. Revisit when an application needs it, since it changes the grammar. Until then, see Known limitations.

### D-27 Data lists render as sibling bullets — *Decided*
- **Alternatives:** render `- `null`` with children, so they round-trip.
- **Why:** the designer's call. Siblings are easier to read in prompts and output. See Known limitations for the cost.

## Known limitations

- **Very deep data.** The depth limit bounds evaluation, not data. A `reduce` that nests lists tens of thousands deep can overflow rendering or (in Rust) dropping such a tree. Rust would abort the process. See the Status section of CRITERIA.
- **Strings can't always render.** A string with a backtick or newline (from `text`) renders verbatim and won't re-parse, because literals have no escape syntax.
- **Data lists don't round-trip through render.** Their children render as siblings by design; the original litmus output depends on it.

## Open questions

None.

## Deliberately left out

- Tail-call optimization, macros, and a `try` form.
- Publishing metadata.
- Syncing with BuildLife or yuwakisaweb.

## How it's used / how it's abused

A host loads MIAL, possibly written by a model or a user, then calls named definitions and gets a value or a sentence.

| Abuse | Prevention | Criteria |
|---|---|---|
| Infinite loop or heavy work | Step budget, uncatchable | R-24 |
| Runaway recursion crashing the host | Counted depth limit | R-25 |
| Reaching host internals by name (`constructor`, `__proto__`) | Envs hold only bound names | R-7 |
| Malformed source hanging the parser | Total tokenizer | R-2 |
| Hiding a runaway behind `error?` | Limits abort past it | R-13 |
| Very deep data crashing rendering or drop | **Not prevented:** see Known limitations | not yet covered |
