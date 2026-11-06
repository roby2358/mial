//! Runs the shared corpus in ../test (test/README.md describes the case format).

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use mial as m;
use serde_json::Value as Json;

fn test_library() -> m::Library {
    vec![
        m::builtin("test-double", m::fixed(1), |a, _| {
            Ok(match a[0].value {
                m::Value::Num(x) => m::num(x * 2.0),
                _ => m::make_error("test-double", "expected number"),
            })
        }),
        m::builtin("test-apply", m::fixed(2), |a, ctx| ctx.apply(&a[0], &a[1..2], "test-apply")),
        m::builtin("test-log", m::fixed(1), |a, ctx| {
            ctx.log(&m::display(&a[0]));
            Ok(a[0].clone())
        }),
    ]
}

fn library_named(name: &str) -> m::Library {
    match name {
        "host" => m::host_library(),
        "test" => test_library(),
        other => panic!("unknown library {other}"),
    }
}

// Numbers compare by value: JSON `1` and `1.0` are the same MIAL number.
fn plain_equal(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| plain_equal(p, q)),
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| plain_equal(v, w)))
        }
        _ => a == b,
    }
}

fn expect_text(check: &Json, key: &str, actual: impl Fn() -> String) -> Result<(), String> {
    let Some(want) = check.get(key) else { return Ok(()) };
    let got = actual();
    let want = want.as_str().expect("text expectation");
    if got == want { Ok(()) } else { Err(format!("{key}: expected {want:?}, got {got:?}")) }
}

fn check_result(check: &Json, result: m::CallResult) -> Result<(), String> {
    if let Some(want) = check.get("error") {
        return match result {
            Err(got) if got == want.as_str().expect("error text") => Ok(()),
            Err(got) => Err(format!("error: expected {want}, got {got:?}")),
            Ok(v) => Err(format!("expected failure {want}, got {}", m::show(&v))),
        };
    }
    let v = result.map_err(|e| format!("expected success, got: {e}"))?;
    expect_text(check, "value", || m::show(&v))?;
    expect_text(check, "markdown", || m::render(&v))?;
    expect_text(check, "compactMarkdown", || m::render_compact(&v))?;
    expect_text(check, "display", || m::display(&v))?;
    expect_text(check, "serialized", || m::serialize(&v))?;
    if let Some(want) = check.get("plain") {
        let got = m::to_plain(&v);
        if !plain_equal(&got, want) {
            return Err(format!("plain: expected {want}, got {got}"));
        }
    }
    Ok(())
}

fn run_check(check: &Json, it: &mut m::Interpreter, logged: &Rc<RefCell<Vec<String>>>) -> Result<(), String> {
    logged.borrow_mut().clear();
    if let Some(name) = check.get("call") {
        let args: Vec<m::Node> = check["args"].as_array().expect("args").iter().map(m::from_plain).collect();
        check_result(check, it.call(name.as_str().expect("call name"), &args))?;
    } else if check.get("run").is_some() {
        check_result(check, it.run())?;
    } else if let Some(text) = check.get("deserialize") {
        check_result(check, m::deserialize(text.as_str().expect("deserialize text")))?;
    } else {
        let got = m::format_number(check["format"].as_f64().expect("format number"));
        let want = check["text"].as_str().expect("format text");
        if got != want {
            return Err(format!("format: expected {want}, got {got}"));
        }
    }
    if let Some(want) = check.get("log") {
        let got: Vec<Json> = logged.borrow().iter().map(|s| Json::String(s.clone())).collect();
        if want.as_array().expect("log") != &got {
            return Err(format!("log: expected {want}, got {got:?}"));
        }
    }
    Ok(())
}

fn strings(v: Option<&Json>) -> Vec<String> {
    v.map_or_else(Vec::new, |a| a.as_array().expect("array").iter().map(|s| s.as_str().expect("text").to_string()).collect())
}

fn run_case(json_path: &Path) -> Result<(), String> {
    let spec: Json = serde_json::from_str(&fs::read_to_string(json_path).unwrap()).unwrap();
    let source = fs::read_to_string(json_path.with_extension("md")).unwrap();
    let parsed = m::parse(&source);
    let want = strings(spec.get("diagnostics"));
    if parsed.diagnostics != want {
        return Err(format!("diagnostics: expected {want:?}, got {:?}", parsed.diagnostics));
    }
    if let Some(p) = spec.get("parsed") {
        let got: Vec<String> = parsed
            .defs
            .iter()
            .map(|d| m::show(&m::node(m::Value::Sym(d.name.as_str().into()), d.children.clone())))
            .collect();
        let want = strings(Some(p));
        if got != want {
            return Err(format!("parsed: expected {want:?}, got {got:?}"));
        }
    }
    expect_text(&spec, "compact", || m::compact_source(&source))?;

    let logged = Rc::new(RefCell::new(Vec::new()));
    let sink = logged.clone();
    let mut it = m::load(
        &source,
        m::LoadConfig {
            libraries: strings(spec.get("libraries")).iter().map(|n| library_named(n)).collect(),
            log: Box::new(move |t| sink.borrow_mut().push(t.to_string())),
            step_limit: spec.get("stepLimit").map_or(m::STEP_LIMIT, |v| v.as_u64().unwrap()),
            depth_limit: spec.get("depthLimit").map_or(m::DEPTH_LIMIT, |v| v.as_u64().unwrap()),
        },
    );
    let names: Vec<String> = parsed.defs.iter().map(|d| d.name.clone()).collect();
    if it.names != names {
        return Err("names disagree with parse".to_string());
    }
    let checks = spec.get("checks").and_then(Json::as_array).cloned().unwrap_or_default();
    for (i, check) in checks.iter().enumerate() {
        run_check(check, &mut it, &logged).map_err(|e| {
            let text = check.to_string();
            let brief: String = text.chars().take(200).collect();
            format!("check {i} {brief}: {e}")
        })?;
    }
    Ok(())
}

fn case_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let p = entry.unwrap().path();
        if p.is_dir() {
            case_files(&p, out);
        } else if p.extension().is_some_and(|e| e == "json") {
            out.push(p);
        }
    }
}

#[test]
fn shared_corpus() {
    let corpus = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("test");
    let mut files = Vec::new();
    case_files(&corpus, &mut files);
    files.sort();
    assert!(!files.is_empty(), "no cases found");
    let failures: Vec<String> = files
        .iter()
        .filter_map(|f| run_case(f).err().map(|e| format!("{}: {e}", f.strip_prefix(&corpus).unwrap().display())))
        .collect();
    println!("{} cases, {} failed", files.len(), failures.len());
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}

#[test]
fn num_turns_a_non_finite_number_into_an_error() {
    for n in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(m::show(&m::num(n)), "<error: num: non-finite number>");
    }
}
