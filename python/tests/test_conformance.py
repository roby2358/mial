"""Runs the shared corpus in ../../test (test/README.md describes the case format)."""

import json
from pathlib import Path

import pytest

import mial as M

CORPUS = Path(__file__).resolve().parents[2] / "test"


def _double(args, ctx):
    x = args[0]
    return M.num(x.value * 2) if isinstance(x.value, float) else M.make_error("test-double", "expected number")


def _log(args, ctx):
    ctx.log(M.display(args[0]))
    return args[0]


TEST_LIBRARY = M.library(
    [
        M.builtin("test-double", M.fixed(1), _double),
        M.builtin("test-apply", M.fixed(2), lambda args, ctx: ctx.apply(args[0], [args[1]], "test-apply")),
        M.builtin("test-log", M.fixed(1), _log),
    ]
)

LIBRARIES = {"host": M.HOST, "test": TEST_LIBRARY}


def check_result(check, result):
    if "error" in check:
        assert not result.ok, f"expected failure, got {M.show(result.value)}"
        assert result.error == check["error"]
        return
    assert result.ok, f"expected success, got: {result.error}"
    v = result.value
    if "value" in check:
        assert M.show(v) == check["value"]
    if "markdown" in check:
        assert M.render(v) == check["markdown"]
    if "compactMarkdown" in check:
        assert M.render_compact(v) == check["compactMarkdown"]
    if "display" in check:
        assert M.display(v) == check["display"]
    if "plain" in check:
        assert M.to_plain(v) == check["plain"]
    if "serialized" in check:
        assert M.serialize(v) == check["serialized"]


CHECKS = {
    "call": lambda check, it: check_result(check, it.call(check["call"], [M.from_plain(a) for a in check["args"]])),
    "run": lambda check, it: check_result(check, it.run()),
    "deserialize": lambda check, it: check_result(check, M.deserialize(check["deserialize"])),
    "format": lambda check, it: _check_format(check),
}


def _check_format(check):
    assert M.format_number(float(check["format"])) == check["text"]


def run_check(check, it, logged):
    logged.clear()
    kind = next(k for k in CHECKS if k in check)
    CHECKS[kind](check, it)
    if "log" in check:
        assert logged == check["log"]


def case_files():
    return sorted(CORPUS.rglob("*.json"))


@pytest.mark.parametrize("path", case_files(), ids=lambda p: str(p.relative_to(CORPUS)))
def test_case(path):
    spec = json.loads(path.read_text(encoding="utf8"))
    source = path.with_suffix(".md").read_bytes().decode("utf8")
    parsed = M.parse(source)
    assert parsed.diagnostics == spec.get("diagnostics", [])
    if "parsed" in spec:
        assert [M.show(M.node(d.name, d.children)) for d in parsed.defs] == spec["parsed"]
    if "compact" in spec:
        assert M.compact_source(source) == spec["compact"]

    logged = []
    it = M.load(
        source,
        libraries=[LIBRARIES[name] for name in spec["libraries"]],
        log=logged.append,
        step_limit=spec.get("stepLimit", M.STEP_LIMIT),
        depth_limit=spec.get("depthLimit", M.DEPTH_LIMIT),
    )
    assert it.names == [d.name for d in parsed.defs]
    for i, check in enumerate(spec.get("checks", [])):
        try:
            run_check(check, it, logged)
        except AssertionError as e:
            raise AssertionError(f"check {i} {json.dumps(check, ensure_ascii=False)[:200]}: {e}") from e
