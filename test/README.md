# Shared test corpus

Every language runs every case here, through its own thin runner. No language is privileged, and there is no skip list. `R-n/` directories belong to the rows in CRITERIA.md; other directories hold integration programs.

A case is a pair of files with the same name:

- `name.md`: real MIAL source, possibly malformed on purpose.
- `name.json`: what must happen.

## `name.json`

| Field | Required | Meaning |
|---|---|---|
| `libraries` | yes | Any of `"host"`, `"test"`. `CORE` is always installed |
| `stepLimit`, `depthLimit` | no | Limits for this case. Absent: the library's `STEP_LIMIT`, `DEPTH_LIMIT` |
| `diagnostics` | no | Exact parse diagnostics. Absent means none are allowed |
| `parsed` | no | `show` of each definition as `(name child...)` |
| `compact` | no | Exact `compactSource` output |
| `checks` | no | Run in order on one interpreter |

## Checks

Exactly one of these starts a check:

| Key | Meaning |
|---|---|
| `"call": name, "args": [...]` | Call a definition. Args go through `fromPlain` |
| `"run": true` | Call `main` |
| `"deserialize": text` | Deserialize the text |
| `"format": number, "text": text` | `formatNumber(number)` equals `text` |

Then, except for `format`, either `"error": text` (exact failure text) or any of these on success:

| Key | Compared with |
|---|---|
| `value` | `show(result)` |
| `markdown` | `render(result)` |
| `compactMarkdown` | `renderCompact(result)` |
| `display` | `display(result)` |
| `plain` | `toPlain(result)` |
| `serialized` | `serialize(result)` |

`log` lists the exact lines logged during that check.

## The `test` library

Each runner builds this library through the public API, which is what proves hosts can add built-ins:

| Name | Arity | Behaviour |
|---|---|---|
| `test-double` | Fixed(1) | Doubles a number; otherwise the error `test-double: expected number` |
| `test-apply` | Fixed(2) | `ctx.apply(f, [x], "test-apply")` |
| `test-log` | Fixed(1) | `ctx.log(display(x))`, then returns `x` |
