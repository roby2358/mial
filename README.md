# MIAL

MIAL (MarkdownIsALisp) is a homoiconic language whose syntax is Markdown, as an embeddable library in four languages. The same program gives the same value, log, diagnostics and error text in all of them.

```markdown
# factorial
- n
- if
  - <= n `1`
  - `1`
  - *
    - n
    - factorial
      - - n `1`

# main
- print
  - factorial `5`
```

Headings define. Bullet nesting forms the tree. Backticks mark literals, and bare words are symbols. `mial` quotes a tree, `eval` runs one, and `tag`, `children` and `make-mial` take code apart and rebuild it.

## Libraries

| Directory | Language | Notes |
|---|---|---|
| `js/` | JavaScript | One plain file, no build step. A script tag gets the global `Mial` (works from `file://`); `require` works too |
| `ts/` | TypeScript | ES module, hand-written separately from `js/` |
| `python/` | Python 3.11+ | No runtime dependencies |
| `rust/` | Rust | Uses `serde_json` and `stacker` |

## Using it

```js
const Mial = require('./js/mial.js');

const it = Mial.load(source, {
  libraries: [Mial.HOST],        // CORE is always installed
  log: (line) => console.log(line),
  stepLimit: Mial.STEP_LIMIT,
  depthLimit: Mial.DEPTH_LIMIT,
});

it.diagnostics;                  // parse problems, as line-numbered sentences
it.run();                        // calls # main
it.call('factorial', [Mial.num(5)]);  // { ok: true, value } or { ok: false, error }
```

Python and Rust are the same shape:

```python
it = mial.load(source, libraries=[mial.HOST], log=print,
               step_limit=mial.STEP_LIMIT, depth_limit=mial.DEPTH_LIMIT)
result = it.call("factorial", [mial.num(5)])
```

```rust
let mut it = mial::load(&source, mial::LoadConfig {
    libraries: vec![mial::host_library()],
    log: Box::new(|line| println!("{line}")),
    step_limit: mial::STEP_LIMIT,
    depth_limit: mial::DEPTH_LIMIT,
});
let result = it.call("factorial", &[mial::num(5.0)]);
```

Add your own built-ins by passing another library:

```js
const mine = Mial.library([
  Mial.builtin('double', Mial.fixed(1), ([x]) => Mial.num(x.value * 2)),
]);
```

## Testing

```
just test
```

Every language runs the same corpus in `test/`: real `.md` programs with `.json` expected results. See `test/README.md`.

The Rust crate needs a C toolchain to build (`sudo apt install build-essential` on Debian or Ubuntu). JS needs Node, TS also needs `npm install` in `ts/`, and Python needs `uv`.

## Documents

- [ONTOLOGY.md](ONTOLOGY.md): the language and interface, the implementation reference
- [CRITERIA.md](CRITERIA.md): how we know it's correct
- [RATIONALE.md](RATIONALE.md): why each choice, and known limitations
- [ARCHITECTURE_LOG.md](ARCHITECTURE_LOG.md): how it changed

MIAL grew out of `markdown_is_a_lisp` in yuwakisaweb and `js/mial.js` in BuildLife, but it's a separate, forward-looking language and isn't compatible with programs written for them.

## License

MIT. See [LICENSE](LICENSE).
