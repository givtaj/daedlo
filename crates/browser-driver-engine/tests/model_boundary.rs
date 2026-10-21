use browser_driver_engine::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Facts {
    state: String,
}

struct Model {
    descriptor: ModelDescriptor,
}

impl ApplicationModel for Model {
    type Facts = Facts;
    type State = String;
    type Command = String;
    type Outcome = OutcomeReport;
    fn descriptor(&self) -> ModelDescriptor {
        self.descriptor.clone()
    }
    fn state(&self, observation: &Observation<Facts>) -> Result<String> {
        Ok(observation.facts.state.clone())
    }
    fn state_id(&self, state: &String) -> String {
        state.clone()
    }
    fn decode_command(&self, id: &str, _params: &Value) -> Result<String> {
        if id == "unimplemented" {
            Err(DriverError::new(
                "missing_handler",
                "Model command handler is missing",
            ))
        } else {
            Ok(id.into())
        }
    }
    fn authorize(&self, _observation: &Observation<Facts>, _command: &String) -> Result<()> {
        Ok(())
    }
    fn verify(
        &self,
        _before: &Observation<Facts>,
        _after: &Observation<Facts>,
        _command: &String,
        _evidence: &Value,
    ) -> Result<OutcomeReport> {
        Ok(OutcomeReport {
            kind: OutcomeKind::Success,
            label: "Observed".into(),
        })
    }
    fn outcome_report(&self, outcome: &OutcomeReport) -> OutcomeReport {
        outcome.clone()
    }
}

fn descriptor() -> ModelDescriptor {
    serde_json::from_value(json!({"id":"boundary","version":"1","label":"Boundary fixture",
        "states":[
            {"id":"root","label":"Root","parent":null,"support":"supported"},
            {"id":"ready","label":"Ready","parent":"root","support":"supported"},
            {"id":"planned","label":"Planned","parent":"root","support":"planned"}
        ],
        "commands":[
            {"id":"plain","label":"Plain","params":{}},
            {"id":"unimplemented","label":"Unimplemented","params":{}},
            {"id":"sign_in","label":"Sign in","params":{},"changesSession":true},
            {"id":"required","label":"Required","params":{"value":{"type":"text","label":"Value","required":true,"maxLength":3}}}
        ],"recipes":[]})).unwrap()
}

fn observation(state: &str) -> Value {
    json!({"connected":true,"session":"a","facts":{"state":state}})
}
fn request(op: &str, fields: Value) -> Value {
    let mut value = json!({"protocol":1,"id":17,"op":op});
    value
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    value
}

#[test]
fn undeclared_planned_and_nonleaf_states_never_become_success() {
    let engine = Engine::new(Model {
        descriptor: descriptor(),
    });
    for (state, expected) in [
        ("missing", "unknown_state"),
        ("planned", "unsupported_state"),
        ("root", "unknown_state"),
    ] {
        let result = engine.dispatch(request(
            "observe",
            json!({"observation":observation(state)}),
        ));
        assert_eq!(result["error_code"], expected, "{result}");
    }
}

#[test]
fn malformed_descriptors_fail_handshake() {
    let baseline = serde_json::to_value(descriptor()).unwrap();
    let mut variants = vec![];
    let mut duplicate = baseline.clone();
    duplicate["states"][1]["id"] = json!("root");
    variants.push(duplicate);
    let mut cycle = baseline.clone();
    cycle["states"][0]["parent"] = json!("ready");
    variants.push(cycle);
    let mut unknown_parent = baseline.clone();
    unknown_parent["states"][1]["parent"] = json!("missing");
    variants.push(unknown_parent);
    let mut bad_recipe = baseline.clone();
    bad_recipe["recipes"] =
        json!([{"id":"broken","label":"Broken","steps":[{"command":"unknown","params":{}}]}]);
    variants.push(bad_recipe);
    let mut bad_default = baseline;
    bad_default["commands"][3]["params"]["value"]["default"] = json!("too long");
    variants.push(bad_default);
    for value in variants {
        let engine = Engine::new(Model {
            descriptor: serde_json::from_value(value).unwrap(),
        });
        let result = engine.dispatch(request("hello", json!({})));
        assert_eq!(result["error_code"], "invalid_model", "{result}");
    }
}

#[test]
fn required_parameters_and_missing_typed_handlers_are_rejected() {
    let engine = Engine::new(Model {
        descriptor: descriptor(),
    });
    let current = observation("ready");
    let first = engine.dispatch(request("observe", json!({"observation":current})));
    for (command, params, expected) in [
        ("required", json!({}), "invalid_params"),
        ("required", json!({"value":"long"}), "invalid_params"),
        ("unimplemented", json!({}), "missing_handler"),
    ] {
        let result=engine.dispatch(request("command",json!({"observation":current,"fingerprint":first["fingerprint"],"command":command,"params":params})));
        assert_eq!(result["error_code"], expected, "{result}");
        assert!(result.get("action").is_none());
    }
}

#[test]
fn only_explicit_session_transition_can_verify_after_session_change() {
    let engine = Engine::new(Model {
        descriptor: descriptor(),
    });
    let before = observation("ready");
    let mut after = before.clone();
    after["session"] = json!("b");
    for (command, expected) in [("plain", false), ("sign_in", true)] {
        let result=engine.dispatch(request("verify",json!({"before":before,"observation":after,"command":command,"params":{},"evidence":{}})));
        assert_eq!(result["ok"], expected, "{result}");
    }
}

#[test]
fn disconnected_observation_disables_actions_and_refuses_effects() {
    let engine = Engine::new(Model {
        descriptor: descriptor(),
    });
    let mut current = observation("ready");
    current["connected"] = json!(false);
    let first = engine.dispatch(request("observe", json!({"observation":current})));
    assert_eq!(first["ok"], true, "{first}");
    assert!(first["commands"]
        .as_array()
        .unwrap()
        .iter()
        .all(|command| command["enabled"] == false));
    let result=engine.dispatch(request("command",json!({"observation":current,"fingerprint":first["fingerprint"],"command":"plain","params":{}})));
    assert_eq!(result["error_code"], "disconnected", "{result}");
}

#[test]
fn unknown_request_fields_and_missing_ids_fail_closed() {
    let engine = Engine::new(Model {
        descriptor: descriptor(),
    });
    let result = engine.dispatch(request("hello", json!({"silentOverride":true})));
    assert_eq!(result["error_code"], "invalid_request");
    assert_eq!(result["id"], 17);
    let result = engine.dispatch(json!({"protocol":1,"op":"hello"}));
    assert_eq!(result["error_code"], "invalid_request");
    assert_eq!(result["id"], Value::Null);
}

fn recipe_engine() -> Engine<Model> {
    let mut value = serde_json::to_value(descriptor()).unwrap();
    value["recipes"] = json!([{"id":"flow","label":"Canonical flow","steps":[
        {"command":"plain","params":{}},
        {"command":"required","params":{"value":"yes"}}
    ]}]);
    Engine::new(Model {
        descriptor: serde_json::from_value(value).unwrap(),
    })
}

#[test]
fn canonical_recipe_context_authorizes_without_changing_observation_identity() {
    let engine = recipe_engine();
    let current = observation("ready");
    let observed = engine.dispatch(request("observe", json!({"observation":current})));
    let context = json!({"recipe":"flow","step":0,"session":"a"});
    let result = engine.dispatch(request(
        "command",
        json!({
            "observation":current,"fingerprint":observed["fingerprint"],
            "command":"plain","params":{},"recipeContext":context
        }),
    ));
    assert_eq!(
        result["ok"], true,
        "A canonical scoped action must reach the typed model: {result}"
    );
    let verified = engine.dispatch(request(
        "verify",
        json!({
            "before":current,"observation":current,"command":"plain","params":{},
            "evidence":{},"recipeContext":context
        }),
    ));
    assert_eq!(verified["ok"], true, "{verified}");
    let after = engine.dispatch(request("observe", json!({"observation":current})));
    assert_eq!(after["fingerprint"], observed["fingerprint"]);
}

#[test]
fn recipe_context_rejects_wrong_step_parameters_and_bound_session() {
    let engine = recipe_engine();
    let current = observation("ready");
    let observed = engine.dispatch(request("observe", json!({"observation":current})));
    for (context, command, params, code) in [
        (
            json!({"recipe":"missing","step":0,"session":"a"}),
            "plain",
            json!({}),
            "recipe_step_mismatch",
        ),
        (
            json!({"recipe":"flow","step":4,"session":"a"}),
            "plain",
            json!({}),
            "recipe_step_mismatch",
        ),
        (
            json!({"recipe":"flow","step":0,"session":"a"}),
            "required",
            json!({"value":"yes"}),
            "recipe_step_mismatch",
        ),
        (
            json!({"recipe":"flow","step":1,"session":"a"}),
            "required",
            json!({"value":"no"}),
            "recipe_step_mismatch",
        ),
        (
            json!({"recipe":"flow","step":0,"session":"b"}),
            "plain",
            json!({}),
            "recipe_session_changed",
        ),
        (
            json!({"recipe":"flow","step":-1,"session":"a"}),
            "plain",
            json!({}),
            "invalid_recipe_context",
        ),
        (
            json!({"recipe":"flow","step":0,"session":"a","extra":true}),
            "plain",
            json!({}),
            "invalid_recipe_context",
        ),
    ] {
        let result = engine.dispatch(request(
            "command",
            json!({
                "observation":current,"fingerprint":observed["fingerprint"],
                "command":command,"params":params,"recipeContext":context
            }),
        ));
        assert_eq!(result["error_code"], code, "{result}");
        assert!(result.get("action").is_none());
    }
}

#[test]
fn recipe_only_commands_are_hidden_and_reject_direct_authorization_and_verification() {
    let mut descriptor =
        recipe_engine().dispatch(request("hello", json!({})))["descriptor"].clone();
    descriptor["commands"][0]["recipeOnly"] = json!(true);
    let engine = Engine::new(Model {
        descriptor: serde_json::from_value(descriptor).unwrap(),
    });
    let hello = engine.dispatch(request("hello", json!({})));
    assert_eq!(hello["capabilities"]["recipeContext"], 1);
    let current = observation("ready");
    let observed = engine.dispatch(request("observe", json!({"observation":current})));
    assert!(observed["commands"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["id"] != "plain"));
    for op in ["command", "verify"] {
        let fields = if op == "command" {
            json!({"observation":current,"fingerprint":observed["fingerprint"],"command":"plain","params":{}})
        } else {
            json!({"before":current,"observation":current,"command":"plain","params":{},"evidence":{}})
        };
        let result = engine.dispatch(request(op, fields.clone()));
        assert_eq!(result["error_code"], "recipe_scope_required", "{result}");
        let mut scoped = fields;
        scoped["recipeContext"] = json!({"recipe":"flow","step":0,"session":"a"});
        assert_eq!(engine.dispatch(request(op, scoped))["ok"], true);
    }
}

#[test]
fn recipe_context_normalizes_defaults_and_verification_checks_both_sessions() {
    let mut descriptor = serde_json::to_value(descriptor()).unwrap();
    descriptor["commands"][3]["params"]["value"]["default"] = json!("yes");
    descriptor["recipes"] = json!([
        {"id":"defaults","label":"Defaults","steps":[{"command":"required","params":{}}]},
        {"id":"transition","label":"Session transition","steps":[{"command":"sign_in","params":{}}]}
    ]);
    let engine = Engine::new(Model {
        descriptor: serde_json::from_value(descriptor).unwrap(),
    });
    let before = observation("ready");
    let observed = engine.dispatch(request("observe", json!({"observation":before})));
    let result = engine.dispatch(request("command", json!({
        "observation":before,"fingerprint":observed["fingerprint"],"command":"required","params":{},
        "recipeContext":{"recipe":"defaults","step":0,"session":"a"}
    })));
    assert_eq!(
        result["action"]["params"],
        json!({"value":"yes"}),
        "{result}"
    );
    let mut after = before.clone();
    after["session"] = json!("b");
    for bound in ["a", "b"] {
        let result = engine.dispatch(request(
            "verify",
            json!({
                "before":before,"observation":after,"command":"sign_in","params":{},"evidence":{},
                "recipeContext":{"recipe":"transition","step":0,"session":bound}
            }),
        ));
        assert_eq!(result["error_code"], "recipe_session_changed", "{result}");
    }
}

struct ScopedModel(Model);
impl ApplicationModel for ScopedModel {
    type Facts = Facts;
    type State = String;
    type Command = String;
    type Outcome = OutcomeReport;
    fn descriptor(&self) -> ModelDescriptor {
        self.0.descriptor()
    }
    fn state(&self, o: &Observation<Facts>) -> Result<String> {
        self.0.state(o)
    }
    fn state_id(&self, s: &String) -> String {
        self.0.state_id(s)
    }
    fn decode_command(&self, id: &str, params: &Value) -> Result<String> {
        self.0.decode_command(id, params)
    }
    fn authorize(&self, _: &Observation<Facts>, _: &String) -> Result<()> {
        Err(DriverError::new(
            "customer_scope_required",
            "This customer action needs a recipe",
        ))
    }
    fn authorize_scoped(
        &self,
        _: &Observation<Facts>,
        _: &String,
        context: Option<&RecipeContext>,
    ) -> Result<()> {
        match context {
            Some(context)
                if context.recipe == "flow" && context.step == 0 && context.session == "a" =>
            {
                Ok(())
            }
            _ => Err(DriverError::new(
                "customer_scope_required",
                "Missing customer recipe context",
            )),
        }
    }
    fn verify(
        &self,
        _: &Observation<Facts>,
        _: &Observation<Facts>,
        _: &String,
        _: &Value,
    ) -> Result<OutcomeReport> {
        Err(DriverError::new(
            "customer_scope_required",
            "Verification needs its original context",
        ))
    }
    fn verify_scoped(
        &self,
        _: &Observation<Facts>,
        _: &Observation<Facts>,
        _: &String,
        _: &Value,
        context: Option<&RecipeContext>,
    ) -> Result<OutcomeReport> {
        assert_eq!(context.unwrap().recipe, "flow");
        assert_eq!(context.unwrap().step, 0);
        Ok(OutcomeReport {
            kind: OutcomeKind::Success,
            label: "Scoped customer evidence observed".into(),
        })
    }
    fn outcome_report(&self, o: &OutcomeReport) -> OutcomeReport {
        o.clone()
    }
}

#[test]
fn typed_model_receives_validated_scope_for_authorization_and_verification() {
    let descriptor = recipe_engine().dispatch(request("hello", json!({})))["descriptor"].clone();
    let engine = Engine::new(ScopedModel(Model {
        descriptor: serde_json::from_value(descriptor).unwrap(),
    }));
    let current = observation("ready");
    let observed = engine.dispatch(request("observe", json!({"observation":current})));
    let fields = json!({"observation":current,"fingerprint":observed["fingerprint"],"command":"plain","params":{}});
    assert_eq!(
        engine.dispatch(request("command", fields.clone()))["error_code"],
        "customer_scope_required"
    );
    let mut scoped = fields;
    scoped["recipeContext"] = json!({"recipe":"flow","step":0,"session":"a"});
    assert_eq!(engine.dispatch(request("command", scoped))["ok"], true);
    let result = engine.dispatch(request(
        "verify",
        json!({
            "before":current,"observation":current,"command":"plain","params":{},"evidence":{},
            "recipeContext":{"recipe":"flow","step":0,"session":"a"}
        }),
    ));
    assert_eq!(
        result["outcome"]["label"], "Scoped customer evidence observed",
        "{result}"
    );
}
