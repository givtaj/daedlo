use browser_driver_engine::Engine;
use notebook_engine::NotebookModel;
use serde_json::{json, Value};

fn obs(phase: &str) -> Value {
    json!({"connected":true,"session":"synthetic-session","facts":{"text":"A note","phase":phase,"urgent":false,"category":"plain","priority":1}})
}

fn request(op: &str, fields: Value) -> Value {
    let mut result = json!({"protocol":1,"id":"test-1","op":op});
    result
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    result
}

fn observed(engine: &Engine<NotebookModel>, observation: Value) -> Value {
    engine.dispatch(request("observe", json!({"observation":observation})))
}

#[test]
fn hello_describes_customer_hierarchy_and_typed_params() {
    let hello = Engine::new(NotebookModel).dispatch(request("hello", json!({})));
    assert_eq!(hello["ok"], true, "{hello}");
    assert_eq!(hello["descriptor"]["id"], "notebook");
    assert_eq!(hello["descriptor"]["states"][1]["parent"], "notebook");
    assert_eq!(
        hello["descriptor"]["commands"][3]["params"]["urgent"]["type"],
        "boolean"
    );
}

#[test]
fn observation_and_command_share_full_fingerprint() {
    let engine = Engine::new(NotebookModel);
    let current = obs("draft");
    let first = observed(&engine, current.clone());
    assert_eq!(first["ok"], true, "{first}");
    assert_eq!(first["state"]["id"], "notebook.draft");
    let result=engine.dispatch(request("command",json!({"observation":current,"fingerprint":first["fingerprint"],"command":"save","params":{}})));
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["action"], json!({"id":"save","params":{}}));
}

#[test]
fn stale_text_or_session_never_authorizes_command() {
    let engine = Engine::new(NotebookModel);
    let first = observed(&engine, obs("draft"));
    for change in ["text", "session"] {
        let mut current = obs("draft");
        if change == "text" {
            current["facts"]["text"] = json!("Changed");
        } else {
            current["session"] = json!("another-session");
        }
        let result=engine.dispatch(request("command",json!({"observation":current,"fingerprint":first["fingerprint"],"command":"save","params":{}})));
        assert_eq!(result["error_code"], "stale_observation", "{result}");
        assert!(result.get("action").is_none());
    }
}

#[test]
fn versions_fail_before_action() {
    let engine = Engine::new(NotebookModel);
    let mut wrong = request("hello", json!({}));
    wrong["protocol"] = json!(2);
    assert_eq!(engine.dispatch(wrong)["error_code"], "protocol_mismatch");
    let mismatch = engine.dispatch(request(
        "hello",
        json!({"model":{"id":"notebook","version":"2"}}),
    ));
    assert_eq!(mismatch["error_code"], "model_mismatch");
}

#[test]
fn missing_unknown_or_malformed_facts_fail_closed() {
    let engine = Engine::new(NotebookModel);
    let mut invalid = vec![];
    let mut missing = obs("draft");
    missing["facts"].as_object_mut().unwrap().remove("text");
    invalid.push(missing);
    let mut unknown = obs("draft");
    unknown["facts"]["secret"] = json!("do not echo");
    invalid.push(unknown);
    invalid.push(obs("imaginary"));
    let mut malformed = obs("draft");
    malformed["facts"]["urgent"] = json!("false");
    invalid.push(malformed);
    for facts in invalid {
        let result = observed(&engine, facts);
        assert_eq!(result["error_code"], "invalid_observation", "{result}");
        assert!(!result.to_string().contains("do not echo"));
    }
}

#[test]
fn command_schema_and_guards_are_enforced() {
    let engine = Engine::new(NotebookModel);
    let current = obs("draft");
    let first = observed(&engine, current.clone());
    for (command, params, code) in [
        ("missing", json!({}), "unknown_command"),
        ("save", json!({"unrecognized":true}), "invalid_params"),
        ("edit", json!({"text":7}), "invalid_params"),
        (
            "change_mode",
            json!({"urgent":true,"category":"invalid","priority":1}),
            "invalid_params",
        ),
        (
            "change_mode",
            json!({"urgent":true,"category":"work","priority":4}),
            "invalid_params",
        ),
        (
            "change_mode",
            json!({"urgent":true,"category":"work","priority":1.5}),
            "invalid_params",
        ),
    ] {
        let result=engine.dispatch(request("command",json!({"observation":current,"fingerprint":first["fingerprint"],"command":command,"params":params})));
        assert_eq!(result["error_code"], code, "{result}");
    }
    let saving = obs("saving");
    let first = observed(&engine, saving.clone());
    let disabled=engine.dispatch(request("command",json!({"observation":saving,"fingerprint":first["fingerprint"],"command":"edit","params":{"text":"new"}})));
    assert_eq!(disabled["error_code"], "command_disabled");
}

#[test]
fn recipe_is_authored_and_revision_bound() {
    let engine = Engine::new(NotebookModel);
    let current = obs("ready");
    let first = observed(&engine, current.clone());
    let result = engine.dispatch(request(
        "recipe",
        json!({"observation":current,"fingerprint":first["fingerprint"],"recipe":"save_example"}),
    ));
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(
        result["plan"],
        json!([{"command":"edit","params":{"text":"Example note"}},{"command":"save","params":{}}])
    );
    let unknown = engine.dispatch(request(
        "recipe",
        json!({"observation":current,"fingerprint":first["fingerprint"],"recipe":"invented"}),
    ));
    assert_eq!(unknown["error_code"], "unknown_recipe");
}

#[test]
fn example_recipe_preserves_an_existing_unsaved_draft() {
    let engine = Engine::new(NotebookModel);
    for phase in ["draft", "validation", "recovery"] {
        let current = obs(phase);
        let first = observed(&engine, current.clone());
        assert_eq!(first["recipes"][0]["enabled"], false, "{first}");
        let result = engine.dispatch(request("recipe", json!({"observation":current,"fingerprint":first["fingerprint"],"recipe":"save_example"})));
        assert_eq!(result["error_code"], "recipe_disabled", "{result}");
        assert!(result.get("plan").is_none());
    }
    for phase in ["ready", "saved"] {
        let current = obs(phase);
        let first = observed(&engine, current.clone());
        let result = engine.dispatch(request("recipe", json!({"observation":current,"fingerprint":first["fingerprint"],"recipe":"save_example"})));
        assert_eq!(result["ok"], true, "{result}");
    }
    let current = obs("saving");
    let first = observed(&engine, current.clone());
    let result = engine.dispatch(request(
        "recipe",
        json!({"observation":current,"fingerprint":first["fingerprint"],"recipe":"save_example"}),
    ));
    assert_eq!(result["error_code"], "command_disabled", "{result}");
}

#[test]
fn verified_save_requires_exact_readback_and_same_session() {
    let engine = Engine::new(NotebookModel);
    for evidence in [
        json!({}),
        json!({"count":0,"latestText":"A note"}),
        json!({"count":2,"latestText":"A note"}),
        json!({"count":1,"latestText":"Wrong"}),
    ] {
        let result=engine.dispatch(request("verify",json!({"before":obs("draft"),"observation":obs("saved"),"command":"save","params":{},"evidence":evidence})));
        assert!(
            result["ok"] == false || result["outcome"]["kind"] == "unknown",
            "{result}"
        );
        assert_ne!(result["outcome"]["kind"], "success");
    }
    let fields = json!({"before":obs("draft"),"observation":obs("saved"),"command":"save","params":{},"evidence":{"count":1,"latestText":"A note"}});
    let result = engine.dispatch(request("verify", fields.clone()));
    assert_eq!(result["ok"], true, "{result}");
    assert_eq!(result["outcome"]["kind"], "success");
    let mut changed = fields;
    changed["observation"]["session"] = json!("different");
    assert_eq!(
        engine.dispatch(request("verify", changed))["error_code"],
        "session_changed"
    );
}

#[test]
fn expected_failure_is_not_successful_persistence() {
    let engine = Engine::new(NotebookModel);
    for (phase, expected) in [
        ("validation", "validation"),
        ("recovery", "recoverable_error"),
        ("saving", "unknown"),
    ] {
        let result=engine.dispatch(request("verify",json!({"before":obs("draft"),"observation":obs(phase),"command":"save","params":{},"evidence":{}})));
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(result["outcome"]["kind"], expected, "{result}");
    }
}
