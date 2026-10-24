use daedlo_engine::*;
use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};

const PRIVATE: &str = "private-label-value-must-not-appear";

struct DescriptorModel(ModelDescriptor);
impl ApplicationModel for DescriptorModel {
    type Facts = Value;
    type State = ();
    type Command = ();
    type Outcome = ();
    fn descriptor(&self) -> ModelDescriptor {
        self.0.clone()
    }
    fn state(&self, _: &Observation<Value>) -> Result<()> {
        unreachable!()
    }
    fn state_id(&self, _: &()) -> String {
        unreachable!()
    }
    fn decode_command(&self, _: &str, _: &Value) -> Result<()> {
        unreachable!()
    }
    fn authorize(&self, _: &Observation<Value>, _: &()) -> Result<()> {
        unreachable!()
    }
    fn verify(
        &self,
        _: &Observation<Value>,
        _: &Observation<Value>,
        _: &(),
        _: &Value,
    ) -> Result<()> {
        unreachable!()
    }
    fn outcome_report(&self, _: &()) -> OutcomeReport {
        unreachable!()
    }
}

fn descriptor() -> ModelDescriptor {
    serde_json::from_value(json!({
        "id": PRIVATE, "version": "1", "label": PRIVATE,
        "states": [
            {"id": "root", "label": PRIVATE, "parent": null, "support": "supported"},
            {"id": "ready", "label": PRIVATE, "parent": "root", "support": "supported"}
        ],
        "commands": [{"id": PRIVATE, "label": PRIVATE, "params": {
            "a": {"type": "boolean", "label": PRIVATE},
            "private-selection": {"type": "select", "label": PRIVATE, "required": true,
                "options": [{"value": PRIVATE, "label": PRIVATE}]},
            "z-number": {"type": "number", "label": PRIVATE, "minimum": 1, "maximum": 2, "default": 1.5},
            "z-text": {"type": "text", "label": PRIVATE, "maxLength": 2, "default": "é🙂"}
        }}],
        "recipes": [{"id": PRIVATE, "label": PRIVATE, "steps": [
            {"command": PRIVATE, "params": {"private-selection": PRIVATE}}
        ]}]
    }))
    .unwrap()
}

fn hello(descriptor: ModelDescriptor) -> Value {
    Engine::new(DescriptorModel(descriptor))
        .dispatch(json!({"protocol": 1, "id": 17, "op": "hello"}))
}

fn assert_diagnostic(response: &Value, path: &str, rule: &str) {
    assert_eq!(response["protocol"], 1, "{response}");
    assert_eq!(response["id"], 17, "{response}");
    assert_eq!(response["ok"], false, "{response}");
    assert_eq!(response["error_code"], "invalid_model", "{response}");
    let error = response["error"].as_str().unwrap();
    assert!(
        error.contains(path),
        "missing exact safe declaration path {path}: {response}"
    );
    assert!(
        error.contains(rule),
        "missing violated rule {rule}: {response}"
    );
    assert!(error.len() <= 512, "diagnostic must be bounded");
    assert!(error.starts_with("Invalid model at "));
    if path.contains(".params[") {
        assert!(error.ends_with(" Parameter indexes are zero-based in sorted name order."));
    }
    assert!(
        !error.contains(PRIVATE),
        "diagnostic leaked descriptor content"
    );
    assert!(
        !error.contains("private-selection"),
        "diagnostic leaked parameter key"
    );
    assert!(
        response.get("descriptor").is_none(),
        "invalid descriptors must stay unavailable"
    );
}

// A real native process executes the public JSON-lines entrypoint. The Rust test
// harness writes its own preamble, so the parent extracts only protocol replies.
#[test]
#[ignore = "subprocess protocol fixture, run only by its parent test"]
fn descriptor_protocol_process() {
    let mut model = descriptor();
    if std::env::var("DAEDLO_TEST_INVALID_DESCRIPTOR").as_deref() == Ok("select-max-length") {
        model.commands[0]
            .params
            .get_mut("private-selection")
            .unwrap()
            .max_length = Some(20);
    }
    serve(DescriptorModel(model)).unwrap();
    std::process::exit(0);
}

fn native_handshake(invalid: bool) -> Vec<Value> {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "descriptor_protocol_process",
            "--ignored",
            "--nocapture",
        ])
        .env(
            "DAEDLO_TEST_INVALID_DESCRIPTOR",
            if invalid { "select-max-length" } else { "none" },
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    input
        .write_all(b"{\"protocol\":1,\"id\":17,\"op\":\"hello\"}\n")
        .unwrap();
    if invalid {
        input.write_all(b"{\"protocol\":1,\"id\":18,\"op\":\"observe\",\"observation\":{\"connected\":true,\"session\":\"fixture\",\"facts\":{}}}\n").unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "native engine failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .filter(|line| line.starts_with('{'))
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn native_hello_identifies_select_max_length_without_exposing_customer_content() {
    let replies = native_handshake(true);
    assert_eq!(replies.len(), 2);
    assert_diagnostic(
        &replies[0],
        "descriptor.commands[0].params[1].maxLength",
        "only permitted for text parameters",
    );
    assert!(replies[0]["error"].as_str().unwrap().contains("max_length"));
    assert_eq!(replies[1]["error_code"], "invalid_model");
    assert_eq!(replies[1]["id"], 18);
    assert_eq!(replies[1]["error"], replies[0]["error"]);
    assert!(replies[1].get("state").is_none());
}

#[test]
fn native_hello_keeps_valid_protocol_one_descriptors_and_capabilities() {
    let replies = native_handshake(false);
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0]["protocol"], 1);
    assert_eq!(replies[0]["id"], 17);
    assert_eq!(replies[0]["ok"], true);
    assert_eq!(
        replies[0]["descriptor"],
        serde_json::to_value(descriptor()).unwrap()
    );
    assert_eq!(replies[0]["capabilities"]["recipeContext"], 1);
}

#[test]
fn descriptor_relationship_diagnostics_locate_the_rejected_declaration() {
    type Case = (
        Box<dyn Fn(&mut ModelDescriptor)>,
        &'static str,
        &'static str,
    );
    let cases: Vec<Case> = vec![
        (
            Box::new(|d| d.id.clear()),
            "descriptor.id",
            "must not be empty",
        ),
        (
            Box::new(|d| d.version.clear()),
            "descriptor.version",
            "must not be empty",
        ),
        (
            Box::new(|d| d.label.clear()),
            "descriptor.label",
            "must not be empty",
        ),
        (
            Box::new(|d| d.states.clear()),
            "descriptor.states",
            "at least one state",
        ),
        (
            Box::new(|d| d.states[1].id.clear()),
            "descriptor.states[1].id",
            "must not be empty",
        ),
        (
            Box::new(|d| d.states[1].id = "root".into()),
            "descriptor.states[1].id",
            "must be unique",
        ),
        (
            Box::new(|d| d.states[1].label.clear()),
            "descriptor.states[1].label",
            "must not be empty",
        ),
        (
            Box::new(|d| d.states[1].parent = Some(PRIVATE.into())),
            "descriptor.states[1].parent",
            "declared state",
        ),
        (
            Box::new(|d| d.states[0].parent = Some("ready".into())),
            "descriptor.states[0].parent",
            "must not form a cycle",
        ),
        (
            Box::new(|d| d.commands[0].id.clear()),
            "descriptor.commands[0].id",
            "must not be empty",
        ),
        (
            Box::new(|d| d.commands.push(d.commands[0].clone())),
            "descriptor.commands[1].id",
            "must be unique",
        ),
        (
            Box::new(|d| d.commands[0].label.clear()),
            "descriptor.commands[0].label",
            "must not be empty",
        ),
        (
            Box::new(|d| {
                let p = d.commands[0].params.remove("a").unwrap();
                d.commands[0].params.insert("".into(), p);
            }),
            "descriptor.commands[0].params[0].name",
            "must not be empty",
        ),
        (
            Box::new(|d| d.commands[0].params.get_mut("a").unwrap().label.clear()),
            "descriptor.commands[0].params[0].label",
            "must not be empty",
        ),
        (
            Box::new(|d| d.commands[0].params.get_mut("a").unwrap().minimum = Some(0.0)),
            "descriptor.commands[0].params[0].minimum",
            "only permitted for number parameters",
        ),
        (
            Box::new(|d| d.commands[0].params.get_mut("a").unwrap().maximum = Some(1.0)),
            "descriptor.commands[0].params[0].maximum",
            "only permitted for number parameters",
        ),
        (
            Box::new(|d| {
                let p = d.commands[0].params.get_mut("a").unwrap();
                p.kind = ParameterType::Number;
                p.minimum = Some(f64::NAN);
            }),
            "descriptor.commands[0].params[0].minimum",
            "must be finite",
        ),
        (
            Box::new(|d| {
                let p = d.commands[0].params.get_mut("a").unwrap();
                p.kind = ParameterType::Number;
                p.maximum = Some(f64::INFINITY);
            }),
            "descriptor.commands[0].params[0].maximum",
            "must be finite",
        ),
        (
            Box::new(|d| {
                let p = d.commands[0].params.get_mut("a").unwrap();
                p.kind = ParameterType::Number;
                p.minimum = Some(2.0);
                p.maximum = Some(1.0);
            }),
            "descriptor.commands[0].params[0].minimum",
            "must not exceed maximum",
        ),
        (
            Box::new(|d| {
                d.commands[0]
                    .params
                    .get_mut("private-selection")
                    .unwrap()
                    .options
                    .clear()
            }),
            "descriptor.commands[0].params[1].options",
            "at least one option",
        ),
        (
            Box::new(|d| {
                d.commands[0]
                    .params
                    .get_mut("private-selection")
                    .unwrap()
                    .kind = ParameterType::Text
            }),
            "descriptor.commands[0].params[1].options",
            "only permitted for select parameters",
        ),
        (
            Box::new(|d| d.commands[0].params.get_mut("a").unwrap().default = Some(json!(PRIVATE))),
            "descriptor.commands[0].params[0].default",
            "must match the parameter type and constraints",
        ),
        (
            Box::new(|d| {
                d.commands[0]
                    .params
                    .get_mut("private-selection")
                    .unwrap()
                    .options[0]
                    .label
                    .clear()
            }),
            "descriptor.commands[0].params[1].options[0].label",
            "must not be empty",
        ),
        (
            Box::new(|d| {
                let p = d.commands[0].params.get_mut("private-selection").unwrap();
                p.options.push(p.options[0].clone());
            }),
            "descriptor.commands[0].params[1].options[1].value",
            "must be unique",
        ),
        (
            Box::new(|d| d.recipes[0].id.clear()),
            "descriptor.recipes[0].id",
            "must not be empty",
        ),
        (
            Box::new(|d| d.recipes.push(d.recipes[0].clone())),
            "descriptor.recipes[1].id",
            "must be unique",
        ),
        (
            Box::new(|d| d.recipes[0].label.clear()),
            "descriptor.recipes[0].label",
            "must not be empty",
        ),
        (
            Box::new(|d| d.recipes[0].steps.clear()),
            "descriptor.recipes[0].steps",
            "at least one step",
        ),
        (
            Box::new(|d| d.recipes[0].steps[0].command = "missing-private-command".into()),
            "descriptor.recipes[0].steps[0].command",
            "declared command",
        ),
        (
            Box::new(|d| d.recipes[0].steps[0].params = json!(PRIVATE)),
            "descriptor.recipes[0].steps[0].params",
            "must be an object",
        ),
        (
            Box::new(|d| d.recipes[0].steps[0].params["undeclared-private-key"] = json!(PRIVATE)),
            "descriptor.recipes[0].steps[0].params",
            "undeclared parameter",
        ),
        (
            Box::new(|d| d.recipes[0].steps[0].params = json!({})),
            "descriptor.recipes[0].steps[0].params",
            "required command parameter is missing",
        ),
        (
            Box::new(|d| d.recipes[0].steps[0].params["private-selection"] = json!(false)),
            "descriptor.recipes[0].steps[0].params",
            "Parameter value does not match its descriptor",
        ),
    ];
    for (change, path, rule) in cases {
        let mut model = descriptor();
        change(&mut model);
        assert_diagnostic(&hello(model), path, rule);
    }
}
