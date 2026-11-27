use daedlo_engine::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Facts {
    pub text: String,
    pub category: Category,
    pub phase: EditorState,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Plain,
    Work,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorState {
    Ready,
    Draft,
    Saving,
    Saved,
    Validation,
    Recovery,
}
#[derive(Debug)]
pub enum State {
    Editor(EditorState),
}
#[derive(Debug)]
pub enum Command {
    Edit { text: String, category: Category },
    Save,
    Discard,
}
#[derive(Default)]
pub struct StarterModel {
    pub invalid_select_constraint: bool,
}

impl ApplicationModel for StarterModel {
    type Facts = Facts;
    type State = State;
    type Command = Command;
    type Outcome = OutcomeReport;

    fn descriptor(&self) -> ModelDescriptor {
        let mut descriptor: ModelDescriptor = serde_json::from_value(json!({
            "id":"starter", "version":"1", "label":"Adapter starter",
            "states":[
                {"id":"editor","label":"Editor","parent":null,"support":"supported"},
                {"id":"editor.ready","label":"Ready","parent":"editor","support":"supported"},
                {"id":"editor.draft","label":"Draft","parent":"editor","support":"supported"},
                {"id":"editor.saving","label":"Saving","parent":"editor","support":"supported"},
                {"id":"editor.saved","label":"Saved","parent":"editor","support":"supported"},
                {"id":"editor.validation","label":"Needs a note","parent":"editor","support":"supported"},
                {"id":"editor.recovery","label":"Response unavailable","parent":"editor","support":"supported"}
            ],
            "commands":[
                {"id":"edit","label":"Edit note","params":{
                    "text":{"type":"text","label":"Note","required":true,"maxLength":1000,"default":"Starter note"},
                    "category":{"type":"select","label":"Category","required":true,"default":"plain","options":[{"value":"plain","label":"Plain"},{"value":"work","label":"Work"}]}
                }},
                {"id":"save","label":"Save note","params":{}},
                {"id":"discard","label":"Discard draft","params":{}}
            ],
            "recipes":[{"id":"save_example","label":"Save an example note","steps":[
                {"command":"edit","params":{"text":"Starter note","category":"plain"}},
                {"command":"save","params":{}}
            ]}]
        })).expect("static starter descriptor");
        if self.invalid_select_constraint {
            descriptor.commands[0]
                .params
                .get_mut("category")
                .unwrap()
                .max_length = Some(20);
        }
        descriptor
    }
    fn state(&self, observation: &Observation<Facts>) -> Result<State> {
        if observation.facts.text.chars().count() > 1000 {
            return Err(DriverError::new(
                "invalid_observation",
                "Note exceeds the fixture limit",
            ));
        }
        Ok(State::Editor(observation.facts.phase))
    }
    fn state_id(&self, state: &State) -> String {
        match state {
            State::Editor(phase) => match phase {
                EditorState::Ready => "editor.ready",
                EditorState::Draft => "editor.draft",
                EditorState::Saving => "editor.saving",
                EditorState::Saved => "editor.saved",
                EditorState::Validation => "editor.validation",
                EditorState::Recovery => "editor.recovery",
            }
            .into(),
        }
    }
    fn decode_command(&self, id: &str, params: &Value) -> Result<Command> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Edit {
            text: String,
            category: Category,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Empty {}
        let invalid = |_| {
            DriverError::new(
                "invalid_params",
                "Parameters do not match the starter command",
            )
        };
        match id {
            "edit" => {
                let value: Edit = serde_json::from_value(params.clone()).map_err(invalid)?;
                Ok(Command::Edit {
                    text: value.text,
                    category: value.category,
                })
            }
            "save" | "discard" => {
                let _: Empty = serde_json::from_value(params.clone()).map_err(invalid)?;
                Ok(if id == "save" {
                    Command::Save
                } else {
                    Command::Discard
                })
            }
            _ => Err(DriverError::new(
                "unknown_command",
                "Unknown starter command",
            )),
        }
    }
    fn authorize(&self, observation: &Observation<Facts>, command: &Command) -> Result<()> {
        if observation.facts.phase == EditorState::Saving {
            return Err(DriverError::new(
                "command_disabled",
                "Wait for the current save",
            ));
        }
        if matches!(command, Command::Save | Command::Discard)
            && !matches!(
                observation.facts.phase,
                EditorState::Draft | EditorState::Validation | EditorState::Recovery
            )
        {
            return Err(DriverError::new("command_disabled", "Edit a draft first"));
        }
        Ok(())
    }
    fn verify(
        &self,
        before: &Observation<Facts>,
        after: &Observation<Facts>,
        command: &Command,
        evidence: &Value,
    ) -> Result<OutcomeReport> {
        let report = |kind, label: &str| {
            Ok(OutcomeReport {
                kind,
                label: label.into(),
            })
        };
        match command {
            Command::Edit { text, category }
                if after.facts.phase == EditorState::Draft
                    && after.facts.text == *text
                    && after.facts.category == *category =>
            {
                report(OutcomeKind::Success, "Draft updated")
            }
            Command::Discard
                if after.facts.phase == EditorState::Ready && after.facts.text.is_empty() =>
            {
                report(OutcomeKind::Success, "Draft discarded")
            }
            Command::Save
                if before.facts.text == after.facts.text
                    && before.facts.category == after.facts.category =>
            {
                match after.facts.phase {
                    EditorState::Validation => {
                        report(OutcomeKind::Validation, "Application requires a note")
                    }
                    EditorState::Recovery => report(
                        OutcomeKind::RecoverableError,
                        "Save response unavailable; persistence is uncertain",
                    ),
                    EditorState::Saved => {
                        #[derive(Deserialize)]
                        #[serde(deny_unknown_fields)]
                        struct Readback {
                            count: i64,
                            matching: bool,
                        }
                        let readback: Readback =
                            serde_json::from_value(evidence.clone()).map_err(|_| {
                                DriverError::new(
                                    "invalid_evidence",
                                    "Save requires operation-scoped independent readback",
                                )
                            })?;
                        if readback.count == 1 && readback.matching {
                            report(OutcomeKind::Success, "Exactly one matching note confirmed")
                        } else {
                            report(
                                OutcomeKind::Unknown,
                                "Readback did not confirm the requested note",
                            )
                        }
                    }
                    _ => report(OutcomeKind::Unknown, "No conclusive save outcome"),
                }
            }
            _ => report(
                OutcomeKind::Unknown,
                "Expected application change was not observed",
            ),
        }
    }
    fn outcome_report(&self, outcome: &OutcomeReport) -> OutcomeReport {
        outcome.clone()
    }
    fn command_available(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        let command = match id {
            "edit" => Command::Edit {
                text: String::new(),
                category: Category::Plain,
            },
            "save" => Command::Save,
            "discard" => Command::Discard,
            _ => {
                return Err(DriverError::new(
                    "unknown_command",
                    "Unknown starter command",
                ))
            }
        };
        self.authorize(observation, &command)
    }
    fn authorize_recipe(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        if id != "save_example" {
            return Err(DriverError::new("unknown_recipe", "Unknown starter recipe"));
        }
        if !observation.facts.text.is_empty() && observation.facts.phase != EditorState::Saved {
            return Err(DriverError::new(
                "recipe_disabled",
                "Save or discard the existing draft first",
            ));
        }
        self.authorize(
            observation,
            &Command::Edit {
                text: "Starter note".into(),
                category: Category::Plain,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn observation(phase: EditorState, text: &str) -> Observation<Facts> {
        Observation {
            connected: true,
            session: "fixture".into(),
            facts: Facts {
                text: text.into(),
                category: Category::Plain,
                phase,
            },
        }
    }
    #[test]
    fn saved_screen_needs_scoped_readback() {
        let model = StarterModel::default();
        let before = observation(EditorState::Draft, "Example");
        let after = observation(EditorState::Saved, "Example");
        assert!(model
            .verify(&before, &after, &Command::Save, &json!({}))
            .is_err());
        assert!(matches!(
            model
                .verify(
                    &before,
                    &after,
                    &Command::Save,
                    &json!({"count":2,"matching":true})
                )
                .unwrap()
                .kind,
            OutcomeKind::Unknown
        ));
    }
    #[test]
    fn unknown_facts_and_parameter_fields_are_rejected() {
        let model = StarterModel::default();
        assert!(model
            .decode_command("save", &json!({"unexpected":true}))
            .is_err());
        assert!(model
            .decode_command("edit", &json!({"text":"x","category":"other"}))
            .is_err());
        assert!(serde_json::from_value::<Facts>(
            json!({"text":"x","category":"plain","phase":"imagined"})
        )
        .is_err());
    }
    #[test]
    fn active_save_and_existing_draft_cannot_be_overwritten() {
        let model = StarterModel::default();
        assert!(model
            .authorize_recipe(
                &observation(EditorState::Draft, "Human draft"),
                "save_example"
            )
            .is_err());
        assert!(model
            .authorize(
                &observation(EditorState::Saving, "Example"),
                &Command::Discard
            )
            .is_err());
    }
}
