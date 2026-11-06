# CRITERIA

How we know MIAL is correct. Each automated row owns `test/R-n/`, a directory of shared cases that **all four languages** run (see `test/README.md`). `js/test/coverage.test.js` fails if rows and directories disagree.

Run everything with `just test`. `js/test/script-tag.test.js` separately proves `js/mial.js` loads as a plain script.

## R — Rules

| ID | Given | Expect | Instrument |
|---|---|---|---|
| R-1 | Backtick literals of every form | Null, booleans, strings and round-tripping numbers parse as such; `1.0`, `1e3`, `+5`, `0x10`, `-0`, `1e21`, `Infinity` stay strings; a lone quote is a one-character string | automated |
| R-2 | Mixed tokens and stray backticks | Tokens split on space, tab and backtick; an unterminated backtick is dropped and reported; no input hangs | automated |
| R-3 | Nested bullets, tabs, odd indents, dedents, CRLF | Tree matches the indentation rule; tabs count 2; odd indents round down with a diagnostic; inline children precede nested ones | automated |
| R-4 | Prose, bullets before a heading, empty bullets, empty definitions | Each yields its exact line-numbered diagnostic, line diagnostics first, then structural ones | automated |
| R-5 | `- a`, `- b`, `- + a b` under a heading | One param plus a diagnostic on `b`; the identity function `- x`, `- x` gets none | automated |
| R-6 | Each definition form | Constant, one-param, `*` multi-param, lone-`*` zero-param, non-`*` head is a body, `- mial` is a zero-arg function, definitions shadow built-ins | automated |
| R-7 | Unknown symbols, host member names, non-symbol operators | Exact `undefined symbol` / `not a function` errors; `constructor`, `__proto__`, `toString` are undefined like any other name | automated |
| R-8 | `mial`, `eval`, `if` | Quote returns its first child unevaluated, extra children are ignored and never run, childless `mial` is an ordinary undefined symbol; `eval` runs data; `if` evaluates only the chosen branch, missing branch is null, traces are exact | automated |
| R-9 | `let` | Bindings run in order and see earlier ones, missing expression or body is null, non-symbol name errors, traces exact | automated |
| R-10 | `lambda` | Lexical capture, not caller's scope; one, many and zero params; invalid spec errors | automated |
| R-11 | `and`, `or` | Short-circuit (the unchosen side's error or log never happens), boolean result, not usable as values | automated |
| R-12 | `call` | Runs zero-arg functions, reaches zero-arg `+`, applies computed functions, non-function errors | automated |
| R-13 | Errors through the call path | `call` reports message plus exact trace; `error?` catches errors; `error?` can't catch limit aborts | automated |
| R-14 | Too many and too few args | Extras ignored, missing null, for closures, builtins, `map` and host `call`; under strict types a missing number errors at its use | automated |
| R-15 | `-`, `*`, `/`, `%` with non-numbers, zero, overflow | Exact type, division-by-zero and non-finite errors; `%` keeps the dividend's sign; zero- and one-arg forms | automated |
| R-16 | `+` over numbers, strings and others | Sum; join with number text; zero args give 0; null, booleans, lists error | automated |
| R-17 | Ordering and equality | Ordering takes numbers only; `eq`/`!=` take anything and compare deeply; string ≠ symbol; closure identity | automated |
| R-18 | Truthiness and predicates | Only childless false, null and 0 are falsy; `null?`, `atom?`, `list?` per shape | automated |
| R-19 | `tag`, `children`, `make-mial`, `mial-of` | Decompose and rebuild any node; a string tag is a symbol; `mial-of` per kind; builtin errors | automated |
| R-20 | `car`, `cdr`, `cons`, `list` | List laws: `cons x null` is `(x)`, `cons` folds right, `cdr` always returns a list or null, atom errors | automated |
| R-21 | `print`, `print-mial`, `parse-mial` | Exact logged lines and return values; `parse-mial` builds `program` and needs a string | automated |
| R-22 | Render of trees, lists, closures, programs | Exact Markdown, canonical and compact; multi-param closures re-parse to the same function; `compactSource` is stable | automated |
| R-23 | `formatNumber` | ECMAScript text for integers, fractions, thresholds, `-0`, and extremes | automated |
| R-24 | A loop against a small step limit | Exact error text at an exact step count; the count resets per call | automated |
| R-25 | Recursion against the depth limit | Exact error text at an exact depth; `DEPTH_LIMIT` is reached before any host stack overflows, including the worst known call shape (`reduce` through `call`) | automated |
| R-26 | `record`, `get`, `put`, `has?`, `keys` | Order kept, `put` replaces in place and doesn't mutate, null reads as empty, non-records error | automated |
| R-27 | `length`, `nth`, `append`, `map`, `filter`, `reduce` | Per the HOST table; errors in callbacks carry traces; non-functions and non-lists error | automated |
| R-28 | `min`, `max`, `abs`, `floor`, `round`, `clamp` | Per the HOST table; `round` halves go up, including 0.49999999999999994 and negatives | automated |
| R-29 | `str`, `text`, `join`, `length` on non-ASCII | Display rules; `text` expands lists; `join` null separator; 🫐 has length 1 | automated |
| R-30 | Library opt-in and a custom library | Without `host`, its names are undefined; `test` built-ins work, and call back into MIAL and log | automated |
| R-31 | `fromPlain`, `toPlain` | Objects, arrays, scalars round-trip; closure and tree forms per the rule | automated |
| R-32 | `serialize`, `deserialize` | Byte-exact JSON across languages, including escapes, hard-to-round numbers and 300 levels of nesting; malformed input gives the one error text | automated |
| R-33 | Every built-in × every argument kind (generated) | All four languages agree on every combination, against a committed golden file from `just cc-matrix` | automated |
| R-34 | `run` | Calls `# main`; missing main is the missing-definition error; constants return themselves | automated |
| R-35 | A hostile deep-data program | Rendering or dropping very deep data never crashes the host | not yet covered |

## U — UI

None. This is a library.

## X — Outcomes

| ID | Criterion | Linked decision |
|---|---|---|
| X-1 | A new application can embed MIAL from any of the four languages using only ONTOLOGY's interface. Fails if it has to reach into internals | D-2 |

## Status

**2026-11-05.** All rows are automated except R-35.

- **Not yet covered:** R-35, deep-data safety. See Known limitations in RATIONALE.
- **Manual only:** X-1, until a real application embeds it.
- **Partial coverage:** R-2 shows specific hostile inputs terminate, not all inputs. R-33 covers one- and two-argument calls with a fixed set of argument kinds, not three-argument built-ins beyond sample rows.
