use daedlo_engine::*;
use serde_json::{json, Value};

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

fn main() -> std::io::Result<()> {
    let mut model = descriptor();
    model.commands[0]
        .params
        .get_mut("private-selection")
        .unwrap()
        .max_length = Some(20);
    serve(DescriptorModel(model))
}
