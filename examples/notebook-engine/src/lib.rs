use browser_driver_engine::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Facts {
    pub text: String,
    pub phase: Phase,
    pub urgent: bool,
    pub category: Category,
    pub priority: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Ready,
    Draft,
    Saving,
    Saved,
    Validation,
    Recovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Plain,
    Work,
}

#[derive(Debug)]
pub enum Command {
    Edit {
        text: String,
    },
    Save,
    Cancel,
    ChangeMode {
        urgent: bool,
        category: Category,
        priority: u8,
    },
}

pub struct NotebookModel;

impl ApplicationModel for NotebookModel {
    type Facts = Facts;
    type State = Phase;
    type Command = Command;
    type Outcome = OutcomeReport;

    fn descriptor(&self) -> ModelDescriptor {
        serde_json::from_value(json!({
            "id":"notebook", "version":"1", "label":"Notebook",
            "states":[
                {"id":"notebook","label":"Notebook","parent":null,"support":"supported"},
                {"id":"notebook.ready","label":"Ready","parent":"notebook","support":"supported"},
                {"id":"notebook.draft","label":"Draft","parent":"notebook","support":"supported"},
                {"id":"notebook.saving","label":"Saving","parent":"notebook","support":"supported"},
                {"id":"notebook.saved","label":"Saved","parent":"notebook","support":"supported"},
                {"id":"notebook.validation","label":"Needs attention","parent":"notebook","support":"supported"},
                {"id":"notebook.recovery","label":"Recoverable error","parent":"notebook","support":"supported"}
            ],
            "commands":[
                {"id":"edit","label":"Edit note","params":{"text":{"type":"text","label":"Note text","required":true,"maxLength":1000,"default":"Example note"}}},
                {"id":"save","label":"Save note","params":{}},
                {"id":"cancel","label":"Discard draft","params":{}},
                {"id":"change_mode","label":"Change note options","params":{
                    "urgent":{"type":"boolean","label":"Urgent","required":true,"default":false},
                    "category":{"type":"select","label":"Category","required":true,"default":"plain","options":[{"value":"plain","label":"Plain"},{"value":"work","label":"Work"}]},
                    "priority":{"type":"number","label":"Priority","required":true,"default":1,"minimum":1,"maximum":3}
                }}
            ],
            "recipes":[{"id":"save_example","label":"Save an example note","steps":[{"command":"edit","params":{"text":"Example note"}},{"command":"save","params":{}}]}]
        })).expect("static notebook descriptor")
    }

    fn state(&self, observation: &Observation<Facts>) -> Result<Phase> {
        if !(1..=3).contains(&observation.facts.priority) {
            return Err(DriverError::new(
                "invalid_observation",
                "Priority is outside 1..3",
            ));
        }
        Ok(observation.facts.phase)
    }

    fn state_id(&self, state: &Phase) -> String {
        format!(
            "notebook.{}",
            match state {
                Phase::Ready => "ready",
                Phase::Draft => "draft",
                Phase::Saving => "saving",
                Phase::Saved => "saved",
                Phase::Validation => "validation",
                Phase::Recovery => "recovery",
            }
        )
    }

    fn decode_command(&self, id: &str, params: &Value) -> Result<Command> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Edit {
            text: String,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Mode {
            urgent: bool,
            category: Category,
            priority: u8,
        }
        let invalid = |_| {
            DriverError::new(
                "invalid_params",
                "Command parameters do not match the notebook model",
            )
        };
        match id {
            "edit" => {
                let p: Edit = serde_json::from_value(params.clone()).map_err(invalid)?;
                Ok(Command::Edit { text: p.text })
            }
            "save" => Ok(Command::Save),
            "cancel" => Ok(Command::Cancel),
            "change_mode" => {
                let p: Mode = serde_json::from_value(params.clone()).map_err(invalid)?;
                Ok(Command::ChangeMode {
                    urgent: p.urgent,
                    category: p.category,
                    priority: p.priority,
                })
            }
            _ => Err(DriverError::new(
                "unknown_command",
                "Unknown notebook command",
            )),
        }
    }

    fn authorize(&self, observation: &Observation<Facts>, command: &Command) -> Result<()> {
        if observation.facts.phase == Phase::Saving {
            return Err(DriverError::new(
                "command_disabled",
                "Wait for the current save to finish",
            ));
        }
        if matches!(command, Command::Save | Command::Cancel)
            && !matches!(
                observation.facts.phase,
                Phase::Draft | Phase::Validation | Phase::Recovery
            )
        {
            return Err(DriverError::new(
                "command_disabled",
                "Open or edit a draft first",
            ));
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
            Command::Edit { text }
                if after.facts.phase == Phase::Draft && after.facts.text == *text =>
            {
                report(OutcomeKind::Success, "Draft updated")
            }
            Command::Cancel if after.facts.phase == Phase::Ready && after.facts.text.is_empty() => {
                report(OutcomeKind::Success, "Draft discarded")
            }
            Command::ChangeMode {
                urgent,
                category,
                priority,
            } if after.facts.urgent == *urgent
                && after.facts.category == *category
                && after.facts.priority == *priority =>
            {
                report(OutcomeKind::Success, "Note options updated")
            }
            Command::Save => {
                if before.facts.text != after.facts.text {
                    return report(OutcomeKind::Unknown, "Draft changed during save");
                }
                match after.facts.phase {
                    Phase::Validation => {
                        report(OutcomeKind::Validation, "Application rejected the note")
                    }
                    Phase::Recovery => report(
                        OutcomeKind::RecoverableError,
                        "Save requires recovery; persistence is not confirmed",
                    ),
                    Phase::Saved => {
                        #[derive(Deserialize)]
                        #[serde(deny_unknown_fields)]
                        struct Readback {
                            count: u64,
                            #[serde(rename = "latestText")]
                            latest_text: String,
                        }
                        let readback:Readback=serde_json::from_value(evidence.clone()).map_err(|_| DriverError::new("invalid_evidence","Saved outcome requires a scoped record count and text read-back"))?;
                        if readback.count == 1 && readback.latest_text == after.facts.text {
                            report(
                                OutcomeKind::Success,
                                "Exactly one matching saved note confirmed",
                            )
                        } else {
                            report(
                                OutcomeKind::Unknown,
                                "Read-back did not confirm exactly one matching note",
                            )
                        }
                    }
                    _ => report(
                        OutcomeKind::Unknown,
                        "Save has no conclusive observed outcome",
                    ),
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

    fn display(&self, observation: &Observation<Facts>) -> Vec<DisplayFact> {
        vec![
            DisplayFact {
                label: "Draft characters".into(),
                value: json!(observation.facts.text.chars().count()),
            },
            DisplayFact {
                label: "Urgent".into(),
                value: json!(observation.facts.urgent),
            },
        ]
    }

    fn command_available(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        let command = match id {
            "save" => Command::Save,
            "cancel" => Command::Cancel,
            "edit" => Command::Edit {
                text: String::new(),
            },
            "change_mode" => Command::ChangeMode {
                urgent: false,
                category: Category::Plain,
                priority: 1,
            },
            _ => {
                return Err(DriverError::new(
                    "unknown_command",
                    "Unknown notebook command",
                ))
            }
        };
        self.authorize(observation, &command)
    }

    fn authorize_recipe(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        if id != "save_example" {
            return Err(DriverError::new(
                "unknown_recipe",
                "Unknown notebook recipe",
            ));
        }
        if matches!(
            observation.facts.phase,
            Phase::Draft | Phase::Validation | Phase::Recovery
        ) && !observation.facts.text.is_empty()
        {
            return Err(DriverError::new(
                "recipe_disabled",
                "Save or discard the existing draft before running this recipe",
            ));
        }
        self.authorize(
            observation,
            &Command::Edit {
                text: "Example note".into(),
            },
        )
    }
}
