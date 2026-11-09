use daedlo_engine::*;
use serde_json::{json, Value};

struct Model(ModelDescriptor);
impl ApplicationModel for Model {
    type Facts = Value;
    type State = ();
    type Command = ();
    type Outcome = ();
    fn descriptor(&self) -> ModelDescriptor {
        self.0.clone()
    }
    fn state(&self, _: &Observation<Value>) -> Result<()> {
        Ok(())
    }
    fn state_id(&self, _: &()) -> String {
        "ready".into()
    }
    fn decode_command(&self, _: &str, _: &Value) -> Result<()> {
        Ok(())
    }
    fn authorize(&self, _: &Observation<Value>, _: &()) -> Result<()> {
        Ok(())
    }
    fn verify(
        &self,
        _: &Observation<Value>,
        _: &Observation<Value>,
        _: &(),
        _: &Value,
    ) -> Result<()> {
        Ok(())
    }
    fn outcome_report(&self, _: &()) -> OutcomeReport {
        OutcomeReport {
            kind: OutcomeKind::Success,
            label: "Observed".into(),
        }
    }
}
fn descriptor_value() -> Value {
    json!({"id":"sensitive","version":"1","label":"Sensitive fixture",
        "states":[{"id":"ready","label":"Ready","parent":null,"support":"supported"}],
        "commands":[{"id":"submit","label":"Submit","params":{
            "value":{"type":"password","label":"Private input","required":true,"maxLength":3}
        }}],"recipes":[]})
}
fn engine(value: Value) -> Engine<Model> {
    let decoded = serde_json::from_value::<ModelDescriptor>(value);
    assert!(
        decoded.is_ok(),
        "An explicit password descriptor must decode"
    );
    Engine::new(Model(decoded.unwrap()))
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
fn password_wire_type_and_legacy_text_remain_explicit_and_strict() {
    let descriptor = descriptor_value();
    let model = engine(descriptor.clone());
    let hello = model.dispatch(request("hello", json!({})));
    assert_eq!(hello["ok"], true);
    assert_eq!(
        hello["descriptor"]["commands"][0]["params"]["value"]["type"],
        "password"
    );
    let mut legacy = descriptor.clone();
    legacy["commands"][0]["params"]["value"]["type"] = json!("text");
    assert_eq!(
        engine(legacy).dispatch(request("hello", json!({})))["ok"],
        true
    );
    let mut unsupported = descriptor;
    unsupported["commands"][0]["params"]["value"]["type"] = json!("secret-ish");
    assert!(serde_json::from_value::<ModelDescriptor>(unsupported).is_err());
}
#[test]
fn password_values_use_the_same_unicode_string_bounds_as_text() {
    let model = engine(descriptor_value());
    let observation = json!({"connected":true,"session":"owned","facts":{}});
    let observed = model.dispatch(request("observe", json!({"observation":observation})));
    for params in [
        json!({"value":""}),
        json!({"value":"é🙂"}),
        json!({"value":" a "}),
    ] {
        let result = model.dispatch(request("command", json!({"command":"submit","params":params,"observation":observation,"fingerprint":observed["fingerprint"]})));
        assert_eq!(result["ok"], true);
        assert_eq!(result["action"]["params"], params);
    }
    for params in [
        json!({}),
        json!({"value":null}),
        json!({"value":42}),
        json!({"value":false}),
        json!({"value":"four"}),
    ] {
        let result = model.dispatch(request("command", json!({"command":"submit","params":params,"observation":observation,"fingerprint":observed["fingerprint"]})));
        assert_eq!(result["error_code"], "invalid_params");
        assert!(result.get("action").is_none());
    }
}
#[test]
fn public_defaults_and_recipe_literals_are_still_validated() {
    let mut descriptor = descriptor_value();
    descriptor["commands"][0]["params"]["value"]["default"] = json!("{}");
    descriptor["recipes"] = json!([{"id":"template","label":"Public template","steps":[{"command":"submit","params":{}}]}]);
    assert_eq!(
        engine(descriptor.clone()).dispatch(request("hello", json!({})))["ok"],
        true
    );
    descriptor["recipes"][0]["steps"][0]["params"]["value"] = json!("four");
    assert_eq!(
        engine(descriptor).dispatch(request("hello", json!({})))["error_code"],
        "invalid_model"
    );
}
