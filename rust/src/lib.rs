//! MIAL (MarkdownIsALisp): Rust library. ONTOLOGY.md is the reference; cite its IDs.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{Map, Number, Value as Json};

pub const STEP_LIMIT: u64 = 200_000;
pub const DEPTH_LIMIT: u64 = 1000;

// Stack growth around evaluation (D-11): keep this much free, and add this much when short.
const STACK_RED_ZONE: usize = 256 * 1024;
const STACK_GROWTH: usize = 8 * 1024 * 1024;

/* ---------------------------------------------------------------- Values and nodes */

#[derive(Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(Rc<str>),
    Sym(Rc<str>),
    Err(Rc<str>),
    Closure(Rc<Closure>),
    Builtin(Rc<Builtin>),
}

#[derive(Clone)]
pub struct Node {
    pub value: Value,
    pub children: Rc<Vec<Node>>,
}

pub struct Env {
    parent: Option<Rc<Env>>,
    vars: RefCell<HashMap<Rc<str>, Node>>,
}

pub struct Closure {
    params: Vec<Rc<str>>,
    body: Vec<Node>,
    env: Rc<Env>,
}

#[derive(Clone, Copy)]
pub struct Arity {
    is_fixed: bool,
    count: usize,
}

/// A limit overrun, unwinding to the top-level call. MIAL errors are nodes, not this.
#[derive(Debug, Clone, Copy)]
pub enum Abort {
    Steps,
    Depth,
}

pub type EvalResult = Result<Node, Abort>;
pub type CallResult = Result<Node, String>;
pub type Library = Vec<Rc<Builtin>>;
type BuiltinFn = dyn Fn(&[Node], &mut Interpreter) -> EvalResult;

pub struct Builtin {
    pub name: String,
    arity: Arity,
    func: Box<BuiltinFn>,
}

pub struct Definition {
    pub name: String,
    pub line: usize,
    pub children: Vec<Node>,
}

pub struct Parsed {
    pub defs: Vec<Definition>,
    pub diagnostics: Vec<String>,
}

pub fn node(value: Value, children: Vec<Node>) -> Node {
    Node { value, children: Rc::new(children) }
}
fn atom(value: Value) -> Node {
    node(value, Vec::new())
}
fn symbol_tree(name: &str, children: Vec<Node>) -> Node {
    node(Value::Sym(name.into()), children)
}
pub fn sym(name: &str) -> Node {
    atom(Value::Sym(name.into()))
}
pub fn str_node(text: &str) -> Node {
    atom(Value::Str(text.into()))
}
pub fn num(n: f64) -> Node {
    if n.is_finite() { atom(Value::Num(n)) } else { make_error("num", "non-finite number") }
}
pub fn boolean(b: bool) -> Node {
    atom(Value::Bool(b))
}
pub fn nil() -> Node {
    atom(Value::Null)
}
pub fn list(items: Vec<Node>) -> Node {
    node(Value::Null, items)
}

impl Node {
    fn is_childless(&self) -> bool {
        self.children.is_empty()
    }
    fn is_list_like(&self) -> bool {
        matches!(self.value, Value::Null)
    }
    fn is_null(&self) -> bool {
        self.is_list_like() && self.is_childless()
    }
    fn is_data_list(&self) -> bool {
        self.is_list_like() && !self.is_childless()
    }
    fn as_number(&self) -> Option<f64> {
        match self.value {
            Value::Num(n) if self.is_childless() => Some(n),
            _ => None,
        }
    }
    fn as_string(&self) -> Option<&str> {
        match &self.value {
            Value::Str(s) if self.is_childless() => Some(s),
            _ => None,
        }
    }
    fn is_symbol(&self) -> bool {
        matches!(self.value, Value::Sym(_)) && self.is_childless()
    }
    fn is_function(&self) -> bool {
        matches!(self.value, Value::Closure(_) | Value::Builtin(_)) && self.is_childless()
    }
    fn is_field(&self) -> bool {
        matches!(self.value, Value::Sym(_)) && self.children.len() == 1
    }
    fn is_record(&self) -> bool {
        matches!(&self.value, Value::Sym(s) if &**s == "record") && self.children.iter().all(Node::is_field)
    }
    fn is_record_like(&self) -> bool {
        self.is_record() || self.is_null()
    }
}

pub fn is_error(n: &Node) -> bool {
    matches!(n.value, Value::Err(_))
}

pub fn is_truthy(n: &Node) -> bool {
    if !n.is_childless() {
        return true;
    }
    match n.value {
        Value::Null | Value::Bool(false) => false,
        Value::Num(x) => x != 0.0,
        _ => true,
    }
}

pub fn type_name(n: &Node) -> &'static str {
    if n.is_list_like() {
        return if n.is_childless() { "null" } else { "list" };
    }
    if !n.is_childless() {
        return "tree";
    }
    match n.value {
        Value::Num(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Str(_) => "string",
        Value::Sym(_) => "symbol",
        Value::Closure(_) | Value::Builtin(_) => "function",
        Value::Err(_) | Value::Null => "error",
    }
}

pub fn make_error(symbol: &str, reason: &str) -> Node {
    atom(Value::Err(format!("{symbol}: {reason}").into()))
}

fn add_trace(err: &Node, reason: &str) -> Node {
    let mut trace: Vec<Node> = err.children.as_ref().clone();
    trace.push(str_node(reason));
    node(err.value.clone(), trace)
}

fn expected(name: &str, what: &str, n: &Node) -> EvalResult {
    Ok(make_error(name, &format!("expected {what}, got {}", type_name(n))))
}

pub fn fixed(n: usize) -> Arity {
    Arity { is_fixed: true, count: n }
}
pub fn variadic(min: usize) -> Arity {
    Arity { is_fixed: false, count: min }
}
pub fn builtin(
    name: &str,
    arity: Arity,
    func: impl Fn(&[Node], &mut Interpreter) -> EvalResult + 'static,
) -> Rc<Builtin> {
    Rc::new(Builtin { name: name.to_string(), arity, func: Box::new(func) })
}

/* ---------------------------------------------------------------- Number text */

/// ECMAScript Number::toString.
pub fn format_number(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    let scientific = format!("{:e}", x.abs());
    let (mantissa, exponent) = scientific.split_once('e').expect("{:e} always has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let point = exponent.parse::<i32>().expect("{:e} exponent is an integer") + 1;
    let count = digits.len() as i32;
    if count <= point && point <= 21 {
        return format!("{sign}{digits}{}", "0".repeat((point - count) as usize));
    }
    if 0 < point && point <= 21 {
        let (whole, fraction) = digits.split_at(point as usize);
        return format!("{sign}{whole}.{fraction}");
    }
    if -6 < point && point <= 0 {
        return format!("{sign}0.{}{digits}", "0".repeat((-point) as usize));
    }
    let e = point - 1;
    let shown = if count == 1 { digits } else { format!("{}.{}", &digits[..1], &digits[1..]) };
    format!("{sign}{shown}e{}{}", if e >= 0 { '+' } else { '-' }, e.abs())
}

fn parse_number(text: &str) -> Option<f64> {
    let n = text.parse::<f64>().ok()?;
    (n.is_finite() && format_number(n) == text).then_some(n)
}

/* ---------------------------------------------------------------- Parser */

fn is_ws(c: char) -> bool {
    c == ' ' || c == '\t' || c == '\r'
}
fn is_gap(b: u8) -> bool {
    b == b' ' || b == b'\t'
}
fn trim_ws(s: &str) -> &str {
    s.trim_matches(is_ws)
}

fn measure_indent(line: &str) -> usize {
    let mut spaces = 0;
    for b in line.bytes() {
        match b {
            b' ' => spaces += 1,
            b'\t' => spaces += 2,
            _ => break,
        }
    }
    spaces
}

fn is_quoted(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[b.len() - 1] == b[0]
}

fn parse_literal(text: &str) -> Node {
    if is_quoted(text) {
        return str_node(&text[1..text.len() - 1]);
    }
    match text {
        "null" => nil(),
        "true" => boolean(true),
        "false" => boolean(false),
        _ => parse_number(text).map_or_else(|| str_node(text), num),
    }
}

fn parse_token(token: &str) -> Node {
    if token.starts_with('`') {
        parse_literal(&token[1..token.len() - 1])
    } else {
        sym(token)
    }
}

// Every delimiter is ASCII, so byte positions are always char boundaries.
fn tokenize(text: &str) -> (Vec<&str>, bool) {
    let b = text.as_bytes();
    let mut tokens = Vec::new();
    let mut unterminated = false;
    let mut i = 0;
    while i < b.len() {
        if is_gap(b[i]) {
            i += 1;
            continue;
        }
        if b[i] == b'`' {
            match text[i + 1..].find('`') {
                None => {
                    unterminated = true;
                    i += 1;
                }
                Some(offset) => {
                    let close = i + 1 + offset;
                    tokens.push(&text[i..=close]);
                    i = close + 1;
                }
            }
            continue;
        }
        let mut end = i;
        while end < b.len() && !is_gap(b[end]) && b[end] != b'`' {
            end += 1;
        }
        tokens.push(&text[i..end]);
        i = end;
    }
    (tokens, unterminated)
}

// A bullet still collecting its nested bullets.
struct Draft {
    value: Value,
    children: Vec<Node>,
    level: usize,
}

fn parse_bullet(content: &str, level: usize) -> (Draft, bool) {
    let (tokens, unterminated) = tokenize(content);
    let Some(first) = tokens.first() else {
        return (Draft { value: Value::Sym("".into()), children: Vec::new(), level }, unterminated);
    };
    let children = tokens[1..].iter().map(|t| parse_token(t)).collect();
    (Draft { value: parse_token(first).value, children, level }, unterminated)
}

fn is_bullet_line(t: &str) -> bool {
    let b = t.as_bytes();
    (b[0] == b'-' || b[0] == b'*') && b.len() > 1 && is_gap(b[1])
}

fn is_param_spec(n: &Node) -> bool {
    match &n.value {
        Value::Sym(name) => n.is_childless() || (&**name == "*" && n.children.iter().all(Node::is_symbol)),
        _ => false,
    }
}

fn structural_diagnostics(def: &Definition, tops: &[usize]) -> Option<String> {
    let c = &def.children;
    if c.is_empty() {
        return Some(format!("line {}: definition \"{}\" has no body — ignored", def.line, def.name));
    }
    if c.len() >= 3 && is_param_spec(&c[0]) && c[1].is_symbol() {
        return Some(format!(
            "line {}: bare symbol \"{}\" in \"# {}\" has its value discarded — declare several parameters with \"- * a b\"",
            tops[1],
            display(&c[1]),
            def.name
        ));
    }
    None
}

// Closes the top draft, attaching it to its parent draft or to the definition.
fn close_top(stack: &mut Vec<Draft>, def: &mut Definition) {
    let top = stack.pop().expect("close_top needs a draft");
    let finished = node(top.value, top.children);
    match stack.last_mut() {
        Some(parent) => parent.children.push(finished),
        None => def.children.push(finished),
    }
}

pub fn parse(source: &str) -> Parsed {
    let mut defs: Vec<Definition> = Vec::new();
    let mut all_tops: Vec<Vec<usize>> = Vec::new();
    let mut diagnostics = Vec::new();
    let mut stack: Vec<Draft> = Vec::new();

    for (idx, line) in source.split('\n').enumerate() {
        let line_no = idx + 1;
        let t = trim_ws(line);
        if t.is_empty() {
            continue;
        }
        if t.starts_with('#') {
            if let Some(def) = defs.last_mut() {
                while !stack.is_empty() {
                    close_top(&mut stack, def);
                }
            }
            let name = trim_ws(t.trim_start_matches('#')).to_string();
            defs.push(Definition { name, line: line_no, children: Vec::new() });
            all_tops.push(Vec::new());
            continue;
        }
        if !is_bullet_line(t) {
            diagnostics.push(format!("line {line_no}: not a \"# heading\" or \"- bullet\" — ignored: {t}"));
            continue;
        }
        let Some(def) = defs.last_mut() else {
            diagnostics.push(format!("line {line_no}: bullet before any \"# heading\" — ignored: {t}"));
            continue;
        };
        let spaces = measure_indent(line);
        let level = spaces / 2;
        if !spaces.is_multiple_of(2) {
            diagnostics.push(format!(
                "line {line_no}: indentation of {spaces} space(s) is not a multiple of 2 — rounded down to level {level}"
            ));
        }
        let (draft, unterminated) = parse_bullet(&t[1..], level);
        if unterminated {
            diagnostics.push(format!("line {line_no}: unterminated backtick literal"));
        }
        while stack.last().is_some_and(|top| top.level >= level) {
            close_top(&mut stack, def);
        }
        if stack.is_empty() {
            all_tops.last_mut().expect("a definition exists").push(line_no);
        }
        stack.push(draft);
    }
    if let Some(def) = defs.last_mut() {
        while !stack.is_empty() {
            close_top(&mut stack, def);
        }
    }
    for (def, tops) in defs.iter().zip(&all_tops) {
        diagnostics.extend(structural_diagnostics(def, tops));
    }
    Parsed { defs, diagnostics }
}

/* ---------------------------------------------------------------- Render, display, show */

fn param_spec(params: &[Rc<str>]) -> Node {
    match params {
        [] => sym("*"),
        [one] => sym(one),
        many => symbol_tree("*", many.iter().map(|p| sym(p)).collect()),
    }
}

fn lambda_form(c: &Closure) -> Node {
    let mut children = vec![param_spec(&c.params)];
    children.extend(c.body.iter().cloned());
    symbol_tree("lambda", children)
}

fn format_value(v: &Value) -> String {
    match v {
        Value::Null => "`null`".to_string(),
        Value::Bool(b) => format!("`{b}`"),
        Value::Num(n) => format!("`{}`", format_number(*n)),
        Value::Str(s) => format!("`\"{s}\"`"),
        Value::Err(m) => format!("`ERROR: {m}`"),
        Value::Closure(_) => "<lambda>".to_string(),
        Value::Builtin(b) => b.name.clone(),
        Value::Sym(s) => s.to_string(),
    }
}

fn inline_count(children: &[Node]) -> usize {
    children
        .iter()
        .take_while(|c| c.is_childless() && !matches!(c.value, Value::Closure(_)))
        .count()
}

fn render_node(n: &Node, indent: usize, compact: bool) -> String {
    if let (Value::Closure(c), true) = (&n.value, n.is_childless()) {
        return render_node(&lambda_form(c), indent, compact);
    }
    if n.is_data_list() {
        return join_mapped(&n.children, "\n", |c| render_node(c, indent, compact));
    }
    let inline = if compact { inline_count(&n.children) } else { 0 };
    let mut head = format!("{}- {}", "  ".repeat(indent), format_value(&n.value));
    for c in &n.children[..inline] {
        head.push(' ');
        head.push_str(&format_value(&c.value));
    }
    let mut lines = vec![head];
    lines.extend(n.children[inline..].iter().map(|c| render_node(c, indent + 1, compact)));
    lines.join("\n")
}

fn join_mapped(items: &[Node], sep: &str, f: impl Fn(&Node) -> String) -> String {
    items.iter().map(f).collect::<Vec<_>>().join(sep)
}

pub fn render(n: &Node) -> String {
    render_node(n, 0, false)
}
pub fn render_compact(n: &Node) -> String {
    render_node(n, 0, true)
}

fn render_definition(def: &Definition) -> String {
    let mut lines = vec![format!("# {}", def.name)];
    lines.extend(def.children.iter().map(render_compact));
    lines.join("\n")
}

pub fn compact_source(text: &str) -> String {
    let defs: Vec<String> = parse(text).defs.iter().map(render_definition).collect();
    format!("{}\n", defs.join("\n\n"))
}

fn atom_word(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Num(n) => format_number(*n),
        Value::Sym(s) => s.to_string(),
        Value::Closure(_) => "<lambda>".to_string(),
        Value::Builtin(b) => b.name.clone(),
        Value::Str(s) => s.to_string(),
        Value::Err(m) => m.to_string(),
    }
}

pub fn display(n: &Node) -> String {
    if !n.is_childless() {
        return render_compact(n);
    }
    match &n.value {
        Value::Err(m) => format!("ERROR: {m}"),
        v => atom_word(v),
    }
}

fn escape_show(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out
}

fn show_value(v: &Value) -> String {
    match v {
        Value::Str(s) => format!("\"{}\"", escape_show(s)),
        Value::Err(m) => format!("<error: {m}>"),
        other => atom_word(other),
    }
}

pub fn show(n: &Node) -> String {
    if n.is_childless() {
        return show_value(&n.value);
    }
    let mut parts = vec![show_value(&n.value)];
    parts.extend(n.children.iter().map(show));
    format!("({})", parts.join(" "))
}

/* ---------------------------------------------------------------- Equality */

fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Num(x), Value::Num(y)) => x == y,
        (Value::Str(x), Value::Str(y)) | (Value::Sym(x), Value::Sym(y)) | (Value::Err(x), Value::Err(y)) => x == y,
        (Value::Closure(x), Value::Closure(y)) => Rc::ptr_eq(x, y),
        (Value::Builtin(x), Value::Builtin(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

fn deep_equal(a: &Node, b: &Node) -> bool {
    same_value(&a.value, &b.value)
        && a.children.len() == b.children.len()
        && a.children.iter().zip(b.children.iter()).all(|(x, y)| deep_equal(x, y))
}

/* ---------------------------------------------------------------- Interpreter */

fn new_env(parent: Option<Rc<Env>>) -> Rc<Env> {
    Rc::new(Env { parent, vars: RefCell::new(HashMap::new()) })
}

fn lookup(env: &Rc<Env>, name: &str) -> Node {
    let mut current = Some(env);
    while let Some(e) = current {
        if let Some(found) = e.vars.borrow().get(name) {
            return found.clone();
        }
        current = e.parent.as_ref();
    }
    make_error(name, "undefined symbol")
}

fn set_var(env: &Rc<Env>, name: Rc<str>, value: Node) {
    env.vars.borrow_mut().insert(name, value);
}

fn symbol_name(n: &Node) -> Rc<str> {
    match &n.value {
        Value::Sym(s) => s.clone(),
        _ => unreachable!("callers check the node is a symbol"),
    }
}

fn extract_params(spec: &Node) -> Vec<Rc<str>> {
    if !spec.is_childless() {
        return spec.children.iter().map(symbol_name).collect();
    }
    let name = symbol_name(spec);
    if &*name == "*" { Vec::new() } else { vec![name] }
}

fn closure_node(params: Vec<Rc<str>>, body: Vec<Node>, env: &Rc<Env>) -> Node {
    atom(Value::Closure(Rc::new(Closure { params, body, env: env.clone() })))
}

fn bind_definition(def: &Definition, env: &Rc<Env>) {
    let c = &def.children;
    if c.is_empty() {
        return;
    }
    let name: Rc<str> = def.name.as_str().into();
    if c.len() == 1 && c[0].is_childless() && !matches!(c[0].value, Value::Sym(_)) {
        set_var(env, name, c[0].clone());
        return;
    }
    let bound = if c.len() >= 2 && is_param_spec(&c[0]) {
        closure_node(extract_params(&c[0]), c[1..].to_vec(), env)
    } else {
        closure_node(Vec::new(), c.clone(), env)
    };
    set_var(env, name, bound);
}

type SpecialForm = fn(&mut Interpreter, &Node, &Rc<Env>) -> EvalResult;

fn special_form(name: &str) -> Option<SpecialForm> {
    Some(match name {
        "mial" => form_mial,
        "eval" => form_eval,
        "if" => form_if,
        "let" => form_let,
        "lambda" => form_lambda,
        "and" => form_and,
        "or" => form_or,
        "call" => form_call,
        "error?" => form_error_p,
        _ => return None,
    })
}

fn form_mial(_: &mut Interpreter, n: &Node, _: &Rc<Env>) -> EvalResult {
    Ok(n.children[0].clone())
}

fn form_eval(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    let inner = it.evaluate(&n.children[0], env)?;
    if is_error(&inner) {
        return Ok(add_trace(&inner, "in eval"));
    }
    it.evaluate(&inner, env)
}

fn form_if(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    let test = it.evaluate(&n.children[0], env)?;
    if is_error(&test) {
        return Ok(add_trace(&test, "in if condition"));
    }
    match n.children.get(if is_truthy(&test) { 1 } else { 2 }) {
        Some(branch) => it.evaluate(branch, env),
        None => Ok(nil()),
    }
}

fn form_let(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    let local = new_env(Some(env.clone()));
    for binding in n.children[0].children.iter() {
        let Value::Sym(name) = &binding.value else {
            return Ok(make_error("let", &format!("binding {} must be a symbol", format_value(&binding.value))));
        };
        let val = match binding.children.first() {
            Some(expr) => it.evaluate(expr, &local)?,
            None => nil(),
        };
        if is_error(&val) {
            return Ok(add_trace(&val, &format!("in let binding {name}")));
        }
        set_var(&local, name.clone(), val);
    }
    it.evaluate_body(&n.children[1..], &local)
}

fn form_lambda(_: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    if !is_param_spec(&n.children[0]) {
        return Ok(make_error("lambda", "invalid parameter spec"));
    }
    Ok(closure_node(extract_params(&n.children[0]), n.children[1..].to_vec(), env))
}

// `and` stops at the first falsy value, `or` at the first truthy one.
fn short_circuit(it: &mut Interpreter, n: &Node, env: &Rc<Env>, stop_on: bool, trace: &str) -> EvalResult {
    for c in n.children.iter() {
        let v = it.evaluate(c, env)?;
        if is_error(&v) {
            return Ok(add_trace(&v, trace));
        }
        if is_truthy(&v) == stop_on {
            return Ok(boolean(stop_on));
        }
    }
    Ok(boolean(!stop_on))
}

fn form_and(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    short_circuit(it, n, env, false, "in and")
}

fn form_or(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    short_circuit(it, n, env, true, "in or")
}

fn form_call(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    let proc = it.evaluate(&n.children[0], env)?;
    if is_error(&proc) {
        return Ok(add_trace(&proc, "in call"));
    }
    match it.evaluate_args(&n.children[1..], env, "call")? {
        Ok(args) => it.apply(&proc, &args, "call"),
        Err(err) => Ok(err),
    }
}

fn form_error_p(it: &mut Interpreter, n: &Node, env: &Rc<Env>) -> EvalResult {
    Ok(boolean(is_error(&it.evaluate(&n.children[0], env)?)))
}

fn shape_args(args: &[Node], is_fixed: bool, count: usize) -> Vec<Node> {
    let taken = if is_fixed { args.len().min(count) } else { args.len() };
    let mut shaped = args[..taken].to_vec();
    while shaped.len() < count {
        shaped.push(nil());
    }
    shaped
}

fn error_text(n: &Node) -> String {
    let Value::Err(message) = &n.value else {
        unreachable!("error_text is only called on errors");
    };
    if n.children.is_empty() {
        return message.to_string();
    }
    let trace: Vec<String> = n.children.iter().map(display).collect();
    format!("{message} ({})", trace.join(" ← "))
}

pub struct LoadConfig {
    pub libraries: Vec<Library>,
    pub log: Box<dyn FnMut(&str)>,
    pub step_limit: u64,
    pub depth_limit: u64,
}

pub struct Interpreter {
    pub diagnostics: Vec<String>,
    pub names: Vec<String>,
    log: Box<dyn FnMut(&str)>,
    step_limit: u64,
    depth_limit: u64,
    steps: u64,
    depth: u64,
    globals: Rc<Env>,
}

impl Drop for Interpreter {
    // Global closures point back at the global Env; clearing it frees the cycle.
    fn drop(&mut self) {
        self.globals.vars.borrow_mut().clear();
    }
}

pub fn load(source: &str, config: LoadConfig) -> Interpreter {
    let parsed = parse(source);
    let globals = new_env(None);
    let libraries = std::iter::once(core_library()).chain(config.libraries);
    for lib in libraries {
        for b in lib {
            set_var(&globals, b.name.as_str().into(), atom(Value::Builtin(b)));
        }
    }
    for def in &parsed.defs {
        bind_definition(def, &globals);
    }
    Interpreter {
        names: parsed.defs.iter().map(|d| d.name.clone()).collect(),
        diagnostics: parsed.diagnostics,
        log: config.log,
        step_limit: config.step_limit,
        depth_limit: config.depth_limit,
        steps: 0,
        depth: 0,
        globals,
    }
}

impl Interpreter {
    pub fn log(&mut self, text: &str) {
        (self.log)(text);
    }

    pub fn evaluate(&mut self, n: &Node, env: &Rc<Env>) -> EvalResult {
        self.steps += 1;
        if self.steps > self.step_limit {
            return Err(Abort::Steps);
        }
        self.depth += 1;
        if self.depth > self.depth_limit {
            return Err(Abort::Depth);
        }
        let result = stacker::maybe_grow(STACK_RED_ZONE, STACK_GROWTH, || self.dispatch(n, env))?;
        self.depth -= 1;
        Ok(result)
    }

    fn dispatch(&mut self, n: &Node, env: &Rc<Env>) -> EvalResult {
        if is_error(n) {
            return Ok(n.clone());
        }
        let Value::Sym(op) = &n.value else {
            return Ok(if n.is_childless() { n.clone() } else { make_error(&format_value(&n.value), "not a function") });
        };
        if n.is_childless() {
            return Ok(lookup(env, op));
        }
        if let Some(form) = special_form(op) {
            return form(self, n, env);
        }
        let proc = lookup(env, op);
        if is_error(&proc) {
            return Ok(proc);
        }
        match self.evaluate_args(&n.children, env, op)? {
            Ok(args) => self.apply(&proc, &args, op),
            Err(err) => Ok(err),
        }
    }

    /// The arguments, or `Err(node)` holding the first failing argument's traced error.
    fn evaluate_args(&mut self, children: &[Node], env: &Rc<Env>, op_name: &str) -> Result<Result<Vec<Node>, Node>, Abort> {
        let mut args = Vec::with_capacity(children.len());
        for child in children {
            let v = self.evaluate(child, env)?;
            if is_error(&v) {
                return Ok(Err(add_trace(&v, &format!("in argument to {op_name}"))));
            }
            args.push(v);
        }
        Ok(Ok(args))
    }

    fn evaluate_body(&mut self, body: &[Node], env: &Rc<Env>) -> EvalResult {
        let mut result = nil();
        for n in body {
            result = self.evaluate(n, env)?;
            if is_error(&result) {
                return Ok(add_trace(&result, "in body"));
            }
        }
        Ok(result)
    }

    pub fn apply(&mut self, proc: &Node, args: &[Node], op_name: &str) -> EvalResult {
        match &proc.value {
            Value::Closure(c) => {
                let local = new_env(Some(c.env.clone()));
                let shaped = shape_args(args, true, c.params.len());
                for (p, v) in c.params.iter().zip(shaped) {
                    set_var(&local, p.clone(), v);
                }
                let result = self.evaluate_body(&c.body, &local)?;
                Ok(if is_error(&result) { add_trace(&result, &format!("in call to {op_name}")) } else { result })
            }
            Value::Builtin(b) => {
                let shaped = shape_args(args, b.arity.is_fixed, b.arity.count);
                let result = (b.func)(&shaped, self)?;
                Ok(if is_error(&result) { add_trace(&result, &format!("in {op_name}")) } else { result })
            }
            _ => Ok(make_error(op_name, "not a function")),
        }
    }

    pub fn call(&mut self, name: &str, args: &[Node]) -> CallResult {
        let Some(proc) = self.globals.vars.borrow().get(name).cloned() else {
            return Err(format!("missing definition \"# {name}\""));
        };
        self.steps = 0;
        self.depth = 0;
        if !proc.is_function() {
            return if args.is_empty() { Ok(proc) } else { Err(format!("\"# {name}\" is not a function")) };
        }
        match self.apply(&proc, args, name) {
            Ok(result) if is_error(&result) => Err(error_text(&result)),
            Ok(result) => Ok(result),
            Err(Abort::Steps) => Err(format!("\"# {name}\" exceeded the step budget of {} evaluations", self.step_limit)),
            Err(Abort::Depth) => Err(format!("\"# {name}\" recursed too deeply (depth limit {})", self.depth_limit)),
        }
    }

    pub fn run(&mut self) -> CallResult {
        self.call("main", &[])
    }
}

/* ---------------------------------------------------------------- Core library */

fn numbers(args: &[Node]) -> Result<Vec<f64>, &Node> {
    args.iter().map(|a| a.as_number().ok_or(a)).collect()
}

fn finite(name: &str, x: f64) -> EvalResult {
    Ok(if x.is_finite() { num(x) } else { make_error(name, "non-finite result") })
}

/// A builtin over numbers: type-checks every argument, then checks the result is finite.
fn numeric(name: &'static str, arity: Arity, compute: impl Fn(&[f64]) -> f64 + 'static) -> Rc<Builtin> {
    builtin(name, arity, move |args, _| match numbers(args) {
        Ok(ns) => finite(name, compute(&ns)),
        Err(bad) => expected(name, "number", bad),
    })
}

fn comparison(name: &'static str, test: fn(f64, f64) -> bool) -> Rc<Builtin> {
    builtin(name, fixed(2), move |args, _| match numbers(args) {
        Ok(ns) => Ok(boolean(test(ns[0], ns[1]))),
        Err(bad) => expected(name, "number", bad),
    })
}

fn plus(args: &[Node], _: &mut Interpreter) -> EvalResult {
    if let Some(bad) = args.iter().find(|a| a.as_number().is_none() && a.as_string().is_none()) {
        return expected("+", "number or string", bad);
    }
    if args.iter().any(|a| a.as_string().is_some()) {
        return Ok(str_node(&args.iter().map(display).collect::<String>()));
    }
    finite("+", args.iter().filter_map(Node::as_number).fold(0.0, |a, b| a + b))
}

fn divide(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let ns = match numbers(args) {
        Ok(ns) => ns,
        Err(bad) => return expected("/", "number", bad),
    };
    let (start, divisors) = if ns.len() == 1 { (1.0, &ns[..]) } else { (ns[0], &ns[1..]) };
    if divisors.contains(&0.0) {
        return Ok(make_error("/", "division by zero"));
    }
    finite("/", divisors.iter().fold(start, |a, b| a / b))
}

fn remainder(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let ns = match numbers(args) {
        Ok(ns) => ns,
        Err(bad) => return expected("%", "number", bad),
    };
    if ns[1] == 0.0 {
        return Ok(make_error("%", "division by zero"));
    }
    finite("%", ns[0] % ns[1])
}

fn make_mial(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let (tag, kids) = (&args[0], &args[1]);
    if !kids.is_list_like() {
        return expected("make-mial", "list", kids);
    }
    let value = match &tag.value {
        Value::Str(s) => Value::Sym(s.clone()),
        other => other.clone(),
    };
    Ok(Node { value, children: kids.children.clone() })
}

fn mial_of(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let f = &args[0];
    match &f.value {
        Value::Builtin(_) => Ok(make_error("mial-of", "builtins have no MIAL source")),
        Value::Closure(c) if !c.params.is_empty() => Ok(lambda_form(c)),
        Value::Closure(c) if c.body.len() == 1 => Ok(c.body[0].clone()),
        Value::Closure(c) => Ok(list(c.body.clone())),
        _ => Ok(f.clone()),
    }
}

fn prepend(head: Node, tail: &[Node]) -> Node {
    let mut items = Vec::with_capacity(tail.len() + 1);
    items.push(head);
    items.extend(tail.iter().cloned());
    list(items)
}

fn cons(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let (last, rest) = args.split_last().expect("cons has arity Variadic(1)");
    let mut tail = last.clone();
    for a in rest.iter().rev() {
        tail = if tail.is_list_like() { prepend(a.clone(), &tail.children) } else { list(vec![a.clone(), tail]) };
    }
    Ok(tail)
}

fn cdr(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let n = &args[0];
    if n.is_childless() && !n.is_list_like() {
        return expected("cdr", "list", n);
    }
    Ok(if n.children.len() <= 1 { nil() } else { list(n.children[1..].to_vec()) })
}

fn parse_mial(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let Some(code) = args[0].as_string() else {
        return expected("parse-mial", "string", &args[0]);
    };
    let defs = parse(code).defs.into_iter().map(|d| symbol_tree(&d.name, d.children)).collect();
    Ok(symbol_tree("program", defs))
}

fn print(args: &[Node], ctx: &mut Interpreter) -> EvalResult {
    let out = args.iter().map(display).collect::<Vec<_>>().join(" ");
    ctx.log(&out);
    Ok(str_node(&out))
}

fn print_mial(args: &[Node], ctx: &mut Interpreter) -> EvalResult {
    ctx.log(&render(&args[0]));
    Ok(args[0].clone())
}

fn car(args: &[Node], _: &mut Interpreter) -> EvalResult {
    Ok(args[0].children.first().cloned().unwrap_or_else(|| make_error("car", "empty list")))
}

fn subtract(ns: &[f64]) -> f64 {
    match ns {
        [x] => -x,
        _ => ns[1..].iter().fold(ns[0], |a, b| a - b),
    }
}

pub fn core_library() -> Library {
    vec![
        builtin("+", variadic(0), plus),
        numeric("-", variadic(1), subtract),
        numeric("*", variadic(0), |ns| ns.iter().fold(1.0, |a, b| a * b)),
        builtin("/", variadic(1), divide),
        builtin("%", fixed(2), remainder),
        comparison("<", |a, b| a < b),
        comparison("<=", |a, b| a <= b),
        comparison(">", |a, b| a > b),
        comparison(">=", |a, b| a >= b),
        builtin("eq", fixed(2), |a, _| Ok(boolean(deep_equal(&a[0], &a[1])))),
        builtin("!=", fixed(2), |a, _| Ok(boolean(!deep_equal(&a[0], &a[1])))),
        builtin("not", fixed(1), |a, _| Ok(boolean(!is_truthy(&a[0])))),
        builtin("null?", fixed(1), |a, _| Ok(boolean(a[0].is_null()))),
        builtin("atom?", fixed(1), |a, _| Ok(boolean(a[0].is_childless()))),
        builtin("list?", fixed(1), |a, _| Ok(boolean(a[0].is_data_list()))),
        builtin("tag", fixed(1), |a, _| Ok(atom(a[0].value.clone()))),
        builtin("children", fixed(1), |a, _| {
            Ok(if a[0].is_childless() { nil() } else { node(Value::Null, a[0].children.as_ref().clone()) })
        }),
        builtin("make-mial", fixed(2), make_mial),
        builtin("mial-of", fixed(1), mial_of),
        builtin("car", fixed(1), car),
        builtin("cdr", fixed(1), cdr),
        builtin("cons", variadic(1), cons),
        builtin("list", variadic(0), |a, _| Ok(list(a.to_vec()))),
        builtin("print", variadic(0), print),
        builtin("print-mial", fixed(1), print_mial),
        builtin("parse-mial", fixed(1), parse_mial),
    ]
}

/* ---------------------------------------------------------------- Host library */

fn key_text(n: &Node) -> Option<Rc<str>> {
    if !n.is_childless() {
        return None;
    }
    match &n.value {
        Value::Str(s) | Value::Sym(s) => Some(s.clone()),
        _ => None,
    }
}

fn field_matches(field: &Node, key: &str) -> bool {
    matches!(&field.value, Value::Sym(s) if &**s == key)
}

fn find_field<'a>(r: &'a Node, key: &str) -> Option<&'a Node> {
    r.children.iter().find(|f| field_matches(f, key))
}

fn field_of(key: &str, value: Node) -> Node {
    symbol_tree(key, vec![value])
}

fn record(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let mut fields = Vec::with_capacity(args.len() / 2 + 1);
    for pair in args.chunks(2) {
        let Some(key) = key_text(&pair[0]) else {
            return expected("record", "key", &pair[0]);
        };
        fields.push(field_of(&key, pair.get(1).cloned().unwrap_or_else(nil)));
    }
    Ok(symbol_tree("record", fields))
}

// Shared guard: a record (or null) and a key, or the expected-type error to return.
fn record_and_key(name: &str, r: &Node, k: &Node) -> Result<Rc<str>, EvalResult> {
    if !r.is_record_like() {
        return Err(expected(name, "record", r));
    }
    key_text(k).ok_or_else(|| expected(name, "key", k))
}

fn get(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let key = match record_and_key("get", &args[0], &args[1]) {
        Ok(key) => key,
        Err(result) => return result,
    };
    Ok(find_field(&args[0], &key).map_or_else(nil, |f| f.children[0].clone()))
}

fn put(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let key = match record_and_key("put", &args[0], &args[1]) {
        Ok(key) => key,
        Err(result) => return result,
    };
    let updated = field_of(&key, args[2].clone());
    let found = find_field(&args[0], &key).is_some();
    let mut fields: Vec<Node> =
        args[0].children.iter().map(|f| if field_matches(f, &key) { updated.clone() } else { f.clone() }).collect();
    if !found {
        fields.push(updated);
    }
    Ok(symbol_tree("record", fields))
}

fn has(args: &[Node], _: &mut Interpreter) -> EvalResult {
    match record_and_key("has?", &args[0], &args[1]) {
        Ok(key) => Ok(boolean(find_field(&args[0], &key).is_some())),
        Err(result) => result,
    }
}

fn keys(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let r = &args[0];
    if !r.is_record_like() {
        return expected("keys", "record", r);
    }
    Ok(list_or_nil(r.children.iter().map(|f| str_node(&symbol_name(f))).collect()))
}

fn list_or_nil(items: Vec<Node>) -> Node {
    if items.is_empty() { nil() } else { list(items) }
}

fn length(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let x = &args[0];
    if let Some(s) = x.as_string() {
        return Ok(num(s.chars().count() as f64));
    }
    if x.is_list_like() {
        return Ok(num(x.children.len() as f64));
    }
    expected("length", "list or string", x)
}

fn nth(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let (items, i) = (&args[0], &args[1]);
    if !items.is_list_like() {
        return expected("nth", "list", items);
    }
    let Some(x) = i.as_number() else {
        return expected("nth", "number", i);
    };
    if x.fract() != 0.0 || x < 0.0 || x >= items.children.len() as f64 {
        return Ok(nil());
    }
    Ok(items.children[x as usize].clone())
}

fn append(args: &[Node], _: &mut Interpreter) -> EvalResult {
    if let Some(bad) = args.iter().find(|a| !a.is_list_like()) {
        return expected("append", "list", bad);
    }
    Ok(list_or_nil(args.iter().flat_map(|a| a.children.iter().cloned()).collect()))
}

fn check_function_and_list(name: &str, f: &Node, items: &Node) -> Option<EvalResult> {
    if !f.is_function() {
        return Some(expected(name, "function", f));
    }
    if !items.is_list_like() {
        return Some(expected(name, "list", items));
    }
    None
}

fn map(args: &[Node], ctx: &mut Interpreter) -> EvalResult {
    let (f, items) = (&args[0], &args[1]);
    if let Some(bad) = check_function_and_list("map", f, items) {
        return bad;
    }
    let mut out = Vec::with_capacity(items.children.len());
    for x in items.children.iter() {
        let r = ctx.apply(f, std::slice::from_ref(x), "map")?;
        if is_error(&r) {
            return Ok(r);
        }
        out.push(r);
    }
    Ok(list_or_nil(out))
}

fn filter(args: &[Node], ctx: &mut Interpreter) -> EvalResult {
    let (f, items) = (&args[0], &args[1]);
    if let Some(bad) = check_function_and_list("filter", f, items) {
        return bad;
    }
    let mut out = Vec::new();
    for x in items.children.iter() {
        let r = ctx.apply(f, std::slice::from_ref(x), "filter")?;
        if is_error(&r) {
            return Ok(r);
        }
        if is_truthy(&r) {
            out.push(x.clone());
        }
    }
    Ok(list_or_nil(out))
}

fn reduce(args: &[Node], ctx: &mut Interpreter) -> EvalResult {
    let (f, items) = (&args[0], &args[2]);
    if let Some(bad) = check_function_and_list("reduce", f, items) {
        return bad;
    }
    let mut acc = args[1].clone();
    for x in items.children.iter() {
        acc = ctx.apply(f, &[acc, x.clone()], "reduce")?;
        if is_error(&acc) {
            return Ok(acc);
        }
    }
    Ok(acc)
}

fn round_half_up(x: f64) -> f64 {
    let low = x.floor();
    if x - low >= 0.5 { low + 1.0 } else { low }
}

fn pick(ns: &[f64], better: fn(f64, f64) -> bool) -> f64 {
    ns[1..].iter().fold(ns[0], |best, &n| if better(n, best) { n } else { best })
}

fn clamp(ns: &[f64]) -> f64 {
    let raised = if ns[0] > ns[1] { ns[0] } else { ns[1] };
    if raised < ns[2] { raised } else { ns[2] }
}

fn text(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let mut lines = Vec::with_capacity(args.len());
    for a in args {
        if a.is_list_like() {
            lines.extend(a.children.iter().map(display));
        } else {
            lines.push(display(a));
        }
    }
    Ok(str_node(&lines.join("\n")))
}

fn join(args: &[Node], _: &mut Interpreter) -> EvalResult {
    let (items, sep) = (&args[0], &args[1]);
    if !items.is_list_like() {
        return expected("join", "list", items);
    }
    let separator = match sep.as_string() {
        Some(s) => s,
        None if sep.is_null() => "",
        None => return expected("join", "string", sep),
    };
    Ok(str_node(&join_mapped(&items.children, separator, display)))
}

pub fn host_library() -> Library {
    vec![
        builtin("record", variadic(0), record),
        builtin("get", fixed(2), get),
        builtin("put", fixed(3), put),
        builtin("has?", fixed(2), has),
        builtin("keys", fixed(1), keys),
        builtin("length", fixed(1), length),
        builtin("nth", fixed(2), nth),
        builtin("append", variadic(0), append),
        builtin("map", fixed(2), map),
        builtin("filter", fixed(2), filter),
        builtin("reduce", fixed(3), reduce),
        numeric("min", variadic(1), |ns| pick(ns, |a, b| a < b)),
        numeric("max", variadic(1), |ns| pick(ns, |a, b| a > b)),
        numeric("abs", fixed(1), |ns| ns[0].abs()),
        numeric("floor", fixed(1), |ns| ns[0].floor()),
        numeric("round", fixed(1), |ns| round_half_up(ns[0])),
        numeric("clamp", fixed(3), clamp),
        builtin("str", fixed(1), |a, _| Ok(str_node(&display(&a[0])))),
        builtin("text", variadic(0), text),
        builtin("join", fixed(2), join),
    ]
}

/* ---------------------------------------------------------------- Plain data */

pub fn from_plain(data: &Json) -> Node {
    match data {
        Json::Null => nil(),
        Json::Bool(b) => boolean(*b),
        Json::Number(n) => num(n.as_f64().expect("serde_json numbers convert to f64")),
        Json::String(s) => str_node(s),
        Json::Array(items) => list_or_nil(items.iter().map(from_plain).collect()),
        Json::Object(fields) => symbol_tree("record", fields.iter().map(|(k, v)| field_of(k, from_plain(v))).collect()),
    }
}

pub fn to_plain(n: &Node) -> Json {
    if n.is_record() {
        let mut fields = Map::new();
        for f in n.children.iter() {
            fields.insert(symbol_name(f).to_string(), to_plain(&f.children[0]));
        }
        return Json::Object(fields);
    }
    if n.is_list_like() {
        return if n.is_childless() { Json::Null } else { Json::Array(n.children.iter().map(to_plain).collect()) };
    }
    if !n.is_childless() {
        return Json::String(show(n));
    }
    match &n.value {
        Value::Err(m) => {
            let mut fields = Map::new();
            fields.insert("error".to_string(), Json::String(m.to_string()));
            Json::Object(fields)
        }
        Value::Num(x) => Json::Number(Number::from_f64(*x).expect("MIAL numbers are finite")),
        Value::Bool(b) => Json::Bool(*b),
        _ => Json::String(display(n)),
    }
}

/* ---------------------------------------------------------------- Serialize */

fn json_text(s: &str) -> String {
    serde_json::to_string(s).expect("strings always serialize")
}

fn serialize_value(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Num(n) => format_number(*n),
        Value::Str(s) => format!("{{\"string\":{}}}", json_text(s)),
        Value::Err(m) => format!("{{\"error\":{}}}", json_text(m)),
        Value::Closure(_) => json_text("<lambda>"),
        Value::Builtin(b) => json_text(&b.name),
        Value::Sym(s) => json_text(s),
    }
}

pub fn serialize(n: &Node) -> String {
    format!("{{\"value\":{},\"children\":[{}]}}", serialize_value(&n.value), join_mapped(&n.children, ",", serialize))
}

fn decode_value(v: &Json) -> Option<Value> {
    match v {
        Json::Null => Some(Value::Null),
        Json::Bool(b) => Some(Value::Bool(*b)),
        Json::Number(n) => n.as_f64().filter(|x| x.is_finite()).map(Value::Num),
        Json::String(s) => Some(Value::Sym(s.as_str().into())),
        Json::Object(fields) if fields.len() == 1 => match (fields.get("string"), fields.get("error")) {
            (Some(Json::String(s)), _) => Some(Value::Str(s.as_str().into())),
            (_, Some(Json::String(m))) => Some(Value::Err(m.as_str().into())),
            _ => None,
        },
        Json::Object(_) | Json::Array(_) => None,
    }
}

fn decode_node(data: &Json) -> Option<Node> {
    let fields = data.as_object().filter(|fields| fields.len() == 2)?;
    let children = fields.get("children")?.as_array()?;
    let value = decode_value(fields.get("value")?)?;
    let decoded: Option<Vec<Node>> = children.iter().map(decode_node).collect();
    Some(node(value, decoded?))
}

// serde_json refuses depth past 128 unless told otherwise, and the other hosts have no such limit.
fn parse_json(text: &str) -> Option<Json> {
    stacker::maybe_grow(STACK_RED_ZONE, STACK_GROWTH, || {
        let mut de = serde_json::Deserializer::from_str(text);
        de.disable_recursion_limit();
        let parsed = Json::deserialize(&mut de).ok()?;
        de.end().ok()?;
        Some(parsed)
    })
}

pub fn deserialize(text: &str) -> CallResult {
    parse_json(text).and_then(|data| decode_node(&data)).ok_or_else(|| "not a serialized node".to_string())
}
