# ONTOLOGY

The implementation reference for the MIAL language and its four libraries. Everything here describes the current design; history lives in ARCHITECTURE_LOG.md.

**Tags:** [D] decided by the designer. [P] proposed by Claude, pending review. [T] tunable number. **Serves:** the goal or quality an item exists for. Cite stable IDs (G-n, D-n, Q-n, R-n), never section numbers.

---

## 0. Purpose [D]

MIAL (MarkdownIsALisp) is a homoiconic language whose syntax is Markdown: headings define, bullet nesting forms the tree, backticks mark literals. This project is that language as an embeddable library, in four languages, for the next application to build on.

**Qualities**
- **Interchangeable:** a MIAL program means the same thing in any host.
- **Legible:** source is readable Markdown, and every failure is a sentence, not a host stack trace.
- **Embeddable:** a host application adds capability by handing in functions.

**Goals, in priority order**
- **G-1 Identical results.** The same MIAL gives the same value, log, diagnostics and error text in JS, TS, Rust and Python, proven by one shared test corpus.
- **G-2 Defined behaviour.** Every input has a specified outcome. No result depends on a host's coercions, stack size or engine messages.
- **G-3 Homoiconicity.** Code and data share one shape, `{value, children}`. The language can take apart, build and run its own code.
- **G-4 Host embedding.** Hosts choose libraries, add built-ins, bound execution, and exchange data and saved state.
- **G-5 Forward-looking.** The language is free to improve. It owes nothing to earlier programs.

**Priorities when goals conflict:** G-1 and G-2 beat convenience in any one host. G-5 beats compatibility with `../buildlife` and `../yuwakisaweb/markdown_is_a_lisp`.

**Non-goals (for now)**
- Back-porting to BuildLife or yuwakisaweb. Both are reference only [D].
- Compatibility with worlds or programs written for them [D].
- Publishing to npm, crates.io or PyPI [D].
- An editor, playground or UI.
- Performance work beyond what the limits in this document need.

---

## 1. Entities

### 1.1 Node [D]
*Serves:* G-3. The one structure for code, data and runtime values.

| Field | Type | Notes |
|---|---|---|
| value | Value | The label |
| children | ordered list of Node | Empty for atoms |

### 1.2 Value [D]
*Serves:* G-1, G-2. A closed set. No host value (`undefined`, `NaN`, Infinity, a host object) is ever a Value.

| Kind | Literal | Notes |
|---|---|---|
| null | `` `null` `` | A childless null is also the empty list |
| boolean | `` `true` `` `` `false` `` | |
| number | `` `42` `` `` `-3.5` `` | IEEE-754 double, always finite |
| string | `` `"hi"` `` | Sequence of Unicode code points |
| symbol | bare word | A name |
| error | none | Message plus trace. Created only by failures |
| closure | none | Params, body, captured Env |
| builtin | none | Name, Arity, host function |

### 1.3 Shapes [D]
*Serves:* G-3. Names for the common Node shapes; `type-name` below uses them in error text.

| Shape | Definition | type-name |
|---|---|---|
| empty list | null value, no children | `null` |
| data list | null value, 1+ children | `list` |
| Record | symbol value `record`; each child is `key` (symbol) with one child, the field's value | `tree` |
| tree | any other value with 1+ children | `tree` |
| atom | any other childless node | `number`, `boolean`, `string`, `symbol`, `function` (closure or builtin), `error` |

### 1.4 Definition [D]
*Serves:* G-3. Output of parsing one heading.

| Field | Type | Notes |
|---|---|---|
| name | text | Heading text after the `#`s, trimmed |
| line | integer | 1-based source line |
| children | list of Node | Top-level bullets |

### 1.5 Env [D]
*Serves:* lexical scoping. `{ parent: Env or none, vars: name → Node }`. Lookup follows `parent`. It holds only names the program or a library bound; host-object members never leak in (R-7).

### 1.6 Arity [P]
*Serves:* G-2. `Fixed(n)` or `Variadic(min)`. How the call path shapes a builtin's arguments (the argument-shaping rule).

### 1.7 Library [P]
*Serves:* G-4. An ordered name → builtin table. Two ship: `CORE` (always installed) and `HOST` (opt-in). Hosts build their own the same way.

### 1.8 Interpreter [P]
*Serves:* G-4. One loaded program. All of its state is per-instance, so instances never interact.

| Field | Type | Notes |
|---|---|---|
| globals | Env | Libraries in order, then definitions |
| names | list of text | Definition names, in order |
| diagnostics | list of text | From parsing |
| log | function(text) | Receives `print` and `print-mial` output |
| stepLimit, depthLimit | integer | Required at load, see Numbers |
| steps, depth | integer | Reset at each top-level `call` |

### 1.9 CallResult [P]
*Serves:* G-4. `{ ok: true, value: Node }` or `{ ok: false, error: text }`. Rust expresses it as `Result<Node, String>`, keeping the same text.

---

## 2. Relations and invariants

- **Same source, libraries, limits, args → same value, log, diagnostics and error text** in all four languages [D]. (G-1)
- **`call` never raises for MIAL-caused failures.** Type errors, missing definitions and limit overruns all become `ok: false` [P]. (G-2)
- **Numbers are finite.** No operation yields NaN or an infinity; it yields an error instead [D]. (G-2)
- **Evaluation never mutates a node.** `put`, `cons`, `append` and friends return new nodes [P].
- **Nothing malformed is dropped silently.** Each ignored line, rounded indent or empty definition produces a diagnostic [D].
- **Parsing is total.** Any text yields defs and diagnostics, and no input hangs or raises [D].
- **MIAL performs no I/O** except calling the host's `log` through `print` and `print-mial` [P].
- **Limits are counted in MIAL terms,** so a program hits them at the same point on every host [P].

---

## 3. Grammar

### 3.1 Lines [D]
*Serves:* G-1, G-3.

Source splits on `\n`. **Whitespace is space, tab and CR only**, so the Unicode whitespace rules of the hosts never apply [P].

| Line, after trimming | Meaning |
|---|---|
| empty | Skipped |
| starts with `#` | Definition. Name is the rest with leading `#`s and whitespace removed |
| `- ` or `* ` then content (space or tab after the marker) | Bullet |
| anything else | Ignored, with a diagnostic |

### 3.2 Indentation [D]
Leading whitespace counts one per space and two per tab. `level = floor(spaces / 2)`. An odd count still parses, with a diagnostic. A bullet's parent is the nearest earlier bullet of lower level in the same definition; if none, it is a top-level child of the definition.

### 3.3 Bullet content [D]
Tokens are separated by space or tab. A backtick starts a literal running to the next backtick; a bare token ends at space, tab or backtick. An unterminated backtick is dropped, with a diagnostic. The first token is the node's value, and later tokens are its first children, before any nested bullets. No tokens yields the symbol with empty name.

### 3.4 Literals [D]
*Serves:* G-1. Inside backticks, tried in order:

| Text | Value |
|---|---|
| length ≥ 2, starts and ends with the same `"` or `'` | string with those quotes stripped [P for the length condition] |
| `null` `true` `false` | those values |
| non-empty, and `formatNumber(parse(text)) == text`, finite | number |
| anything else | string with that exact text |

So `1.0`, `1e3`, `+5`, `0x10` and `-0` are strings. A literal cannot contain a backtick; there is no escape syntax.

### 3.5 Number text [D]
*Serves:* G-1. `formatNumber` is ECMAScript `Number::toString`: the shortest digits that round-trip; decimal notation for `1e-7 ≤ |x| < 1e21`, otherwise `d.ddde+21` form; `-0` prints as `0`.

### 3.6 Definition forms [D]
*Serves:* G-3. Tested in order:

```
children == []                                   → no binding, diagnostic [P]
one child, a childless literal                   → constant
2+ children, first is a parameter spec           → closure(params, rest)
otherwise                                        → closure([], children)
```

**Parameter spec** [P]: a childless symbol (one param, or `*` for none), or `*` with childless-symbol children (those params). The head of a multi-param spec must be `*`, so `- f x` followed by `- g x` is a two-statement body, not a spec.

A heading over a single `mial` child is an ordinary zero-arg function whose result is the quoted tree [D]. Read it with `call`.

---

## 4. Rules

### 4.1 Evaluate [P]
*Serves:* G-2, G-3.

```
evaluate(n, env):
  steps += 1; if steps > stepLimit: abort step-budget
  depth += 1; if depth > depthLimit: abort depth
  n is error                     → n
  n childless and symbol         → lookup, else error "<name>: undefined symbol"
  n childless                    → n
  n.value not a symbol           → error "<format(value)>: not a function"
  n.value is a special form      → that form
  otherwise                      → proc = lookup; args left to right, stopping at the first error
                                   (trace "in argument to <op>"); apply(proc, args, op)
```

### 4.2 Special forms [D]
*Serves:* G-3. Recognized only on a node with children, matched before any lookup.

| Form | Rule |
|---|---|
| `mial` x | Returns x unevaluated. Extra children are ignored, with no diagnostic [D] |
| `eval` x | Evaluates x, then evaluates the result. Trace `in eval` |
| `if` c a b | Evaluates c (trace `in if condition`), then only the chosen branch. A missing branch is null |
| `let` bindings body… | The first child's children are bindings `name` with one expression, evaluated in order in a new scope. A missing expression is null. A non-symbol name is an error. Trace `in let binding <name>` |
| `lambda` spec body… | Closure over the current Env. The spec must be a parameter spec, or the error is `lambda: invalid parameter spec` |
| `and` x… / `or` x… | Left to right, stopping at the first deciding value; returns a boolean [D] |
| `call` f args… | Evaluates f, then args, and applies them. How zero-arg functions run, and how computed functions are called [D] |
| `error?` x | Evaluates x and returns whether it is an error. Catches errors, never limit aborts [P] |

### 4.3 Apply and argument shaping [D]
*Serves:* G-2. **Must-ignore semantics:** extra arguments are ignored, missing ones are null. One path for closures and builtins, and for calls from MIAL, from `map` and from the host.

```
shape(params count or arity, args):
  Fixed(n)/closure(n) → first n of args, padded with null
  Variadic(min)       → args, padded with null up to min
apply(proc, args, op):
  closure → new Env over captured; bind shaped args; run body; trace "in call to <op>"
  builtin → fn(shaped args, ctx); if error, trace "in <op>"
  else    → error "<op>: not a function"
```

A body runs in order, stops at the first error (trace `in body`), and returns the last value; an empty body returns null.

### 4.4 Errors [P]
*Serves:* G-2, legibility. An error's message is `<symbol>: <reason>`; its children are trace strings, innermost first. `call` reports `<message> (<trace ← trace>)`, or just the message when there's no trace. Errors propagate unless `error?` catches them.

### 4.5 Truthiness [P]
*Serves:* G-2. Falsy means childless and `false`, null or `0`. Everything else is truthy, including empty strings, data lists and functions.

### 4.6 Equality [P]
*Serves:* G-2. `eq` and `!=` accept any types and compare deeply: same kind, equal value, equal children in order. A string never equals a symbol. Functions compare by identity. `0` equals `-0`.

### 4.7 Core built-ins [D]
*Serves:* G-3. Always installed. Type failure text is `<name>: expected <what>, got <type-name>`.

| Name | Arity | Rule |
|---|---|---|
| `+` | Variadic(0) | No args → `0`. All numbers → sum. Numbers and strings with at least one string → join, numbers via `formatNumber`. Anything else → error |
| `-` | Variadic(1) | One arg negates, otherwise folds left. Numbers only |
| `*` | Variadic(0) | No args → `1`, otherwise product. Numbers only |
| `/` | Variadic(1) | One arg is the reciprocal, otherwise folds left. Numbers only. A zero divisor is `/: division by zero` |
| `%` | Fixed(2) | Remainder takes the dividend's sign. Numbers only. A zero divisor is `%: division by zero` |
| `<` `<=` `>` `>=` | Fixed(2) | Numbers only |
| `eq` `!=` | Fixed(2) | The equality rule |
| `not` | Fixed(1) | The truthiness rule |
| `null?` | Fixed(1) | Empty list |
| `atom?` | Fixed(1) | Childless |
| `list?` | Fixed(1) | Data list |
| `tag` | Fixed(1) | The node's value as an atom |
| `children` | Fixed(1) | Children as a list; none → null |
| `make-mial` | Fixed(2) | A node from a tag and a list (or null). A string tag denotes a symbol |
| `mial-of` | Fixed(1) | Closure → its code (no params: the body, or a list of bodies; params: a `lambda` form). Builtin → `mial-of: builtins have no MIAL source`. Anything else → itself |
| `car` | Fixed(1) | First child; childless → `car: empty list` |
| `cdr` | Fixed(1) | Rest of the children as a list. Null → null. Any other atom → error [P] |
| `cons` | Variadic(1) | Folds right. The last arg is the tail: a list is prepended to, null is the empty list [P], and any other value becomes the final element |
| `list` | Variadic(0) | Data list of the args; none → null |
| `print` | Variadic(0) | Logs the `display` of each arg joined by a space. Returns that string |
| `print-mial` | Fixed(1) | Logs the render of the arg. Returns the arg |
| `parse-mial` | Fixed(1) | String → node `program` with one child per definition, labelled by name |

Any arithmetic result that isn't finite is `<name>: non-finite result`. Applies to every number operation here and in HOST.

### 4.8 HOST built-ins [D]
*Serves:* G-4. Opt-in. Keys may be strings or symbols. A null record reads as empty.

| Name | Arity | Rule |
|---|---|---|
| `record` | Variadic(0) | Key/value pairs. A missing final value is null |
| `get` | Fixed(2) | The field's value, or null. A non-record is an error |
| `put` | Fixed(3) | New Record. Replaces in place, otherwise appends. A non-record is an error |
| `has?` | Fixed(2) | Whether the field exists |
| `keys` | Fixed(1) | Field names as a list of strings |
| `length` | Fixed(1) | Code points of a string, or items of a list. Others are an error [D] |
| `nth` | Fixed(2) | The item, or null when out of range or non-integer. A non-number index is an error |
| `append` | Variadic(0) | Concatenates lists. A non-list is an error |
| `map` `filter` | Fixed(2) | Function and list. Stops at the first error |
| `reduce` | Fixed(3) | Function, initial value and list, folding left |
| `min` `max` | Variadic(1) | Numbers only |
| `abs` `floor` | Fixed(1) | Numbers only |
| `round` | Fixed(1) | Halves round toward positive infinity |
| `clamp` | Fixed(3) | `min(hi, max(lo, x))` |
| `str` | Fixed(1) | `display` of the arg, as a string |
| `text` | Variadic(0) | `display` of each arg joined by newline. A list contributes one line per item; null contributes none |
| `join` | Fixed(2) | `display` of each item joined by the separator, a string or null (empty) |

### 4.9 Display [P]
*Serves:* G-1. String → its text. Number → `formatNumber`. Null, booleans → their word. Symbol or builtin → its name. Closure → `<lambda>`. Error → `ERROR: <message>`. Anything with children → compact render.

### 4.10 Render [D]
*Serves:* G-3. Node → Markdown, using `- ` bullets and 2 spaces per level.

```
format(value): null/number/boolean in backticks; string `"s"`; error `ERROR: m`; symbol/builtin bare
closure        → render its lambda form: lambda, then spec, then body [D]
data list      → children as sibling bullets at this indent
atom           → "- format(value)"
tree           → "- format(value)", children one level deeper
compact tree   → as tree, but leading childless non-closure children stay inline on the same line
```

A zero-param closure's spec is `*`. Programs render as `# name` then bullets, with a blank line between definitions. `compactSource(text)` is the compact render of its parse plus a final newline.

### 4.11 Show [P]
*Serves:* G-1. One-line canonical text used by the shared tests and for debugging. Atoms: number text, `true`, `null`, `"escaped"` (escaping `\` `"` newline, CR, tab), symbol or builtin name, `<lambda>`, `<error: m>`. Compound: `(head child child)`, for example `(null 1 2)`.

### 4.12 Serialize [D]
*Serves:* G-4. Saved state moves between languages byte for byte. Canonical JSON with no whitespace and fixed key order: `{"value":V,"children":[...]}`. V: number via `formatNumber`, `true`/`false`, `null`, a JSON string for a symbol, `{"string":s}`, `{"error":m}`. A closure saves as the string `<lambda>` (its environment doesn't serialize) and a builtin as a symbol of its name. Strings use minimal JSON escaping with non-ASCII raw. `deserialize` returns a CallResult; malformed input of any kind is `not a serialized node`.

### 4.13 Plain data [P]
*Serves:* G-4. `fromPlain`: JSON-like host data to nodes (object → Record, array → list). `toPlain`: back. Record → object, list → array, empty list → null, string or symbol → text, number and boolean as themselves, closure → `<lambda>`, error → `{error: message}`, other tree → its `show` text.

### 4.14 Limits [D]
*Serves:* G-1, G-2. Aborts unwind straight to the top-level `call` and can't be caught by `error?`.

```
steps > stepLimit  → `"# <name>" exceeded the step budget of <stepLimit> evaluations`
depth > depthLimit → `"# <name>" recursed too deeply (depth limit <depthLimit>)`
```

---

## 5. Automation

None.

---

## 6. Numbers [T]

| Name | Value | Unit | Decision |
|---|---|---|---|
| `STEP_LIMIT` | 200000 | evaluations per top-level call | D-11 |
| `DEPTH_LIMIT` | 1000 | nested evaluations | D-11 |

Each library exports both. Hosts pass limits explicitly at load, and these are the recommended values.

---

## 7. Interface

Names are shown in JS/TS spelling. Rust and Python use `snake_case`. Where a name would collide with the language, Python has `str_node`, `bool_node`, `list_node`, Rust has `str_node`, `boolean`, and Rust's libraries are the functions `core_library()` and `host_library()`. `load` takes keyword arguments in Python and a `LoadConfig` struct in Rust.

### Commands

| Command | Effect |
|---|---|
| `load(source, {libraries, log, stepLimit, depthLimit})` → Interpreter | Parses, installs `CORE` then `libraries`, binds definitions. All fields are required. A definition may shadow a built-in |
| `interp.call(name, args)` → CallResult | Resets the counters, applies the named definition. Missing → `missing definition "# <name>"`. A constant with no args returns itself; with args → `"# <name>" is not a function` |
| `interp.run()` → CallResult | `call("main", [])` |

### Queries

| Query | Returns |
|---|---|
| `parse(source)` | `{defs, diagnostics}` |
| `render(node)`, `renderCompact(node)`, `compactSource(text)` | Markdown |
| `display(node)`, `show(node)`, `formatNumber(n)` | Text |
| `serialize(node)`, `deserialize(text)` | JSON text, CallResult |
| `fromPlain(data)`, `toPlain(node)` | Nodes, host data |
| `typeName(node)`, `isError(node)`, `isTruthy(node)` | Inspection |

### Building values and libraries

| Name | Purpose |
|---|---|
| `node(value, children)`, `sym`, `str`, `num`, `bool`, `nil`, `list(items)`, `makeError(symbol, reason)` | Node construction |
| `fixed(n)`, `variadic(min)` | Arity |
| `builtin(name, arity, fn)` | `fn(args, ctx)` returns a Node. `ctx.apply(proc, args, name)` calls back into MIAL. `ctx.log(text)` logs |
| `library(builtins)` | A Library from a list of builtins (a plain list in Rust) |
| `CORE`, `HOST` | The shipped libraries |
| `STEP_LIMIT`, `DEPTH_LIMIT` | Recommended limits |

### Client contract

Hosts use only this interface. A failing builtin returns `makeError`; raising is reserved for host bugs, and `call` reports it as `"# <name>" crashed: <message>` where the host language can catch it.
