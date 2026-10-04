use browser_driver_engine::{
    ApplicationModel, DisplayFact, DriverError, ModelDescriptor, Observation, OutcomeKind,
    OutcomeReport, Result,
};
use roots_qa_driver::ux::{
    Calendar, Editing, Home, Journal, Profile, Root, Signin, Strain, Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Session {
    SignedOut,
    Customer,
    Admin,
    Unknown,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Screen {
    Home,
    Signin,
    Profile,
    Journal,
    Unknown,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Pending {
    None,
    Signin,
    ProfileSave,
    JournalSave,
    StrainSave,
    Load,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ErrorKind {
    None,
    ValidationEmpty,
    ValidationOverlong,
    StrainDuplicate,
    Signin,
    RecoverableSave,
    HistoryLoad,
    StrainLoad,
    CalendarLoad,
    Forbidden,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Capabilities {
    restart_api: bool,
    shared_compare: bool,
    route_faults: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Facts {
    connected: bool,
    session: Session,
    session_key: String,
    screen: Screen,
    profile_draft: bool,
    journal_draft: bool,
    strain_draft: bool,
    form_open: bool,
    pending: Pending,
    error: ErrorKind,
    saved: bool,
    selected_day: bool,
    mobile: bool,
    field_fingerprint: String,
    draft_token: String,
    history_count: usize,
    available_controls: Vec<String>,
    capabilities: Capabilities,
}
#[derive(Clone)]
enum Command {
    Home,
    Profile,
    Journal,
    RefreshConnections,
    Signin,
    SigninInvalid,
    Signout,
    ProfileEdit(String),
    ProfileSave,
    LogExperience,
    JournalFill(String, Option<String>),
    JournalSave,
    JournalCancel,
    Mobile,
    Desktop,
}
impl Command {
    fn id(&self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Profile => "profile",
            Self::Journal => "journal",
            Self::RefreshConnections => "refresh_connections",
            Self::Signin => "signin",
            Self::SigninInvalid => "signin_invalid",
            Self::Signout => "signout",
            Self::ProfileEdit(_) => "profile_edit",
            Self::ProfileSave => "profile_save",
            Self::LogExperience => "log_experience",
            Self::JournalFill(..) => "journal_fill",
            Self::JournalSave => "journal_save",
            Self::JournalCancel => "journal_cancel",
            Self::Mobile => "mobile",
            Self::Desktop => "desktop",
        }
    }
    fn params(&self) -> Value {
        match self {
            Self::ProfileEdit(value) => json!({"value":value}),
            Self::JournalFill(notes, rating) => {
                let mut p = json!({"notes":notes});
                if let Some(r) = rating {
                    p["rating"] = json!(r);
                }
                p
            }
            _ => json!({}),
        }
    }
}
struct Roots;
fn fail(code: &str, message: impl Into<String>) -> DriverError {
    DriverError::new(code, message)
}
fn legacy(f: &Facts, op: &str, c: Option<&Command>) -> Value {
    let facts = serde_json::to_value(f).expect("facts serialize");
    let mut request = json!({"op":op,"observation":facts});
    if let Some(command) = c {
        let observed = roots_qa_driver::respond(json!({"op":"observe","observation":facts}));
        request["fingerprint"] = observed["state"]["fingerprint"].clone();
        request["command"] = json!(command.id());
        request["params"] = command.params();
    }
    roots_qa_driver::respond(request)
}
fn legacy_ok(value: Value) -> Result<Value> {
    if value["ok"] == true {
        Ok(value)
    } else {
        Err(fail(
            value["error_code"].as_str().unwrap_or("legacy_rejected"),
            value["error"]
                .as_str()
                .unwrap_or("Roots model rejected observation"),
        ))
    }
}
// Explicit bridge from the pinned legacy model to stable public wire IDs. No
// Debug formatting is emitted in the new descriptor or observation contract.
fn states() -> Vec<(&'static str, &'static str, Root)> {
    vec![
        (
            "Root::Home(Home::Connectivity)",
            "home.connectivity",
            Root::Home(Home::Connectivity),
        ),
        (
            "Root::Signin(Signin::Form)",
            "signin.form",
            Root::Signin(Signin::Form),
        ),
        (
            "Root::Signin(Signin::Pending)",
            "signin.pending",
            Root::Signin(Signin::Pending),
        ),
        (
            "Root::Signin(Signin::Error)",
            "signin.error",
            Root::Signin(Signin::Error),
        ),
        (
            "Root::Profile(Profile::Editing(Editing::Ready))",
            "profile.editing.ready",
            Root::Profile(Profile::Editing(Editing::Ready)),
        ),
        (
            "Root::Profile(Profile::Editing(Editing::Draft))",
            "profile.editing.draft",
            Root::Profile(Profile::Editing(Editing::Draft)),
        ),
        (
            "Root::Profile(Profile::Editing(Editing::Saving))",
            "profile.editing.saving",
            Root::Profile(Profile::Editing(Editing::Saving)),
        ),
        (
            "Root::Profile(Profile::Editing(Editing::Saved))",
            "profile.editing.saved",
            Root::Profile(Profile::Editing(Editing::Saved)),
        ),
        (
            "Root::Profile(Profile::Validation(Validation::EmptyError))",
            "profile.validation.empty",
            Root::Profile(Profile::Validation(Validation::EmptyError)),
        ),
        (
            "Root::Profile(Profile::Validation(Validation::OverlongError))",
            "profile.validation.overlong",
            Root::Profile(Profile::Validation(Validation::OverlongError)),
        ),
        (
            "Root::Profile(Profile::Loading)",
            "profile.loading",
            Root::Profile(Profile::Loading),
        ),
        (
            "Root::Profile(Profile::Recovery)",
            "profile.recovery",
            Root::Profile(Profile::Recovery),
        ),
        (
            "Root::Profile(Profile::Forbidden)",
            "profile.forbidden",
            Root::Profile(Profile::Forbidden),
        ),
        (
            "Root::Journal(Journal::Loading)",
            "journal.loading",
            Root::Journal(Journal::Loading),
        ),
        (
            "Root::Journal(Journal::Experience(Editing::Draft))",
            "journal.experience.draft",
            Root::Journal(Journal::Experience(Editing::Draft)),
        ),
        (
            "Root::Journal(Journal::Experience(Editing::Saving))",
            "journal.experience.saving",
            Root::Journal(Journal::Experience(Editing::Saving)),
        ),
        (
            "Root::Journal(Journal::Experience(Editing::Saved))",
            "journal.experience.saved",
            Root::Journal(Journal::Experience(Editing::Saved)),
        ),
        (
            "Root::Journal(Journal::Calendar(Calendar::Month))",
            "journal.calendar.month",
            Root::Journal(Journal::Calendar(Calendar::Month)),
        ),
        (
            "Root::Journal(Journal::Calendar(Calendar::SelectedDay))",
            "journal.calendar.selected_day",
            Root::Journal(Journal::Calendar(Calendar::SelectedDay)),
        ),
        (
            "Root::Journal(Journal::Strain(Strain::Draft))",
            "journal.strain.draft",
            Root::Journal(Journal::Strain(Strain::Draft)),
        ),
        (
            "Root::Journal(Journal::Strain(Strain::Saving))",
            "journal.strain.saving",
            Root::Journal(Journal::Strain(Strain::Saving)),
        ),
        (
            "Root::Journal(Journal::Strain(Strain::Duplicate))",
            "journal.strain.duplicate",
            Root::Journal(Journal::Strain(Strain::Duplicate)),
        ),
        (
            "Root::Journal(Journal::Validation(Validation::EmptyError))",
            "journal.validation.empty",
            Root::Journal(Journal::Validation(Validation::EmptyError)),
        ),
        (
            "Root::Journal(Journal::Validation(Validation::OverlongError))",
            "journal.validation.overlong",
            Root::Journal(Journal::Validation(Validation::OverlongError)),
        ),
        (
            "Root::Journal(Journal::Recovery)",
            "journal.recovery",
            Root::Journal(Journal::Recovery),
        ),
        (
            "Root::Journal(Journal::Forbidden)",
            "journal.forbidden",
            Root::Journal(Journal::Forbidden),
        ),
    ]
}
impl ApplicationModel for Roots {
    type Facts = Facts;
    type State = Root;
    type Command = Command;
    type Outcome = OutcomeReport;
    fn descriptor(&self) -> ModelDescriptor {
        let groups = [
            "home",
            "signin",
            "profile",
            "profile.editing",
            "profile.validation",
            "journal",
            "journal.experience",
            "journal.calendar",
            "journal.strain",
            "journal.validation",
        ];
        let mut state_values: Vec<Value> = groups
            .iter()
            .map(|id| {
                json!({"id":id,"label":id,
            "parent":id.rsplit_once('.').map(|(p,_)|p),"support":"supported"})
            })
            .collect();
        state_values.extend(states().into_iter().map(|(_, id, _)| {
            json!({"id":id,"label":id.rsplit('.').next(),
            "parent":id.rsplit_once('.').map(|(p,_)|p),"support":"supported"})
        }));
        state_values.push(
            json!({"id":"strains","label":"Strains (planned)","parent":null,"support":"planned"}),
        );
        let commands = vec![
            json!({"id":"home","label":"Home","params":{}}),
            json!({"id":"profile","label":"Profile","params":{}}),
            json!({"id":"journal","label":"Smoking Journal","params":{}}),
            json!({"id":"refresh_connections","label":"Refresh connections","params":{}}),
            json!({"id":"signin","label":"Sign in","params":{},"changesSession":true}),
            json!({"id":"signin_invalid","label":"Show sign-in error","params":{}}),
            json!({"id":"signout","label":"Sign out","params":{},"changesSession":true}),
            json!({"id":"profile_edit","label":"Edit display name","params":{"value":{"type":"text","label":"Display name","required":true,"maxLength":101}}}),
            json!({"id":"profile_save","label":"Save profile","params":{}}),
            json!({"id":"log_experience","label":"Log experience","params":{}}),
            json!({"id":"journal_fill","label":"Edit experience","params":{"notes":{"type":"text","label":"Notes","required":true,"maxLength":4001},"rating":{"type":"select","label":"Rating","options":[{"value":"","label":"Unrated"},{"value":"1","label":"1"},{"value":"2","label":"2"},{"value":"3","label":"3"},{"value":"4","label":"4"},{"value":"5","label":"5"}]}}}),
            json!({"id":"journal_save","label":"Save experience / Retry","params":{}}),
            json!({"id":"journal_cancel","label":"Cancel experience","params":{}}),
            json!({"id":"mobile","label":"Mobile viewport","params":{}}),
            json!({"id":"desktop","label":"Desktop viewport","params":{}}),
        ];
        serde_json::from_value(json!({"id":"roots","version":"d4008e3-v1","label":"Roots pinned consumer",
            "states":state_values,"commands":commands,"recipes":[{"id":"journal-draft","label":"Open a Journal draft","steps":[{"command":"journal","params":{}},{"command":"log_experience","params":{}}]}]})).expect("static valid descriptor")
    }
    fn state(&self, o: &Observation<Facts>) -> Result<Root> {
        if o.connected != o.facts.connected || o.session != o.facts.session_key {
            return Err(fail(
                "invalid_observation",
                "Envelope contradicts Roots facts",
            ));
        }
        let r = legacy_ok(legacy(&o.facts, "observe", None))?;
        let label = r["state"]["root"]
            .as_str()
            .ok_or_else(|| fail("unknown_state", "Roots destination is unknown"))?;
        states()
            .into_iter()
            .find(|(l, _, _)| *l == label)
            .map(|(_, _, s)| s)
            .ok_or_else(|| fail("unknown_state", "Roots destination is not mapped"))
    }
    fn state_id(&self, s: &Root) -> String {
        states()
            .into_iter()
            .find(|(_, _, r)| r == s)
            .map(|(_, id, _)| id.to_string())
            .unwrap_or_else(|| "unknown".into())
    }
    fn decode_command(&self, id: &str, p: &Value) -> Result<Command> {
        let text = |key: &str| {
            p[key]
                .as_str()
                .map(str::to_string)
                .ok_or_else(|| fail("invalid_params", format!("Missing string {key}")))
        };
        Ok(match id {
            "home" => Command::Home,
            "profile" => Command::Profile,
            "journal" => Command::Journal,
            "refresh_connections" => Command::RefreshConnections,
            "signin" => Command::Signin,
            "signin_invalid" => Command::SigninInvalid,
            "signout" => Command::Signout,
            "profile_edit" => Command::ProfileEdit(text("value")?),
            "profile_save" => Command::ProfileSave,
            "log_experience" => Command::LogExperience,
            "journal_fill" => {
                Command::JournalFill(text("notes")?, p["rating"].as_str().map(str::to_string))
            }
            "journal_save" => Command::JournalSave,
            "journal_cancel" => Command::JournalCancel,
            "mobile" => Command::Mobile,
            "desktop" => Command::Desktop,
            _ => return Err(fail("unknown_command", "Unknown Roots command")),
        })
    }
    fn command_available(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        let r = legacy_ok(legacy(&o.facts, "observe", None))?;
        let c = r["commands"]
            .as_array()
            .and_then(|xs| xs.iter().find(|c| c["id"] == id))
            .ok_or_else(|| fail("unknown_command", "Unknown Roots command"))?;
        if c["enabled"] == true {
            Ok(())
        } else {
            Err(fail(
                "guard_rejected",
                c["reason"].as_str().unwrap_or("Roots command unavailable"),
            ))
        }
    }
    fn authorize(&self, o: &Observation<Facts>, c: &Command) -> Result<()> {
        legacy_ok(legacy(&o.facts, "command", Some(c))).map(|_| ())
    }
    fn verify(
        &self,
        _: &Observation<Facts>,
        after: &Observation<Facts>,
        c: &Command,
        e: &Value,
    ) -> Result<OutcomeReport> {
        // Pinned Roots leaves its previous saved notice visible when an edit
        // returns exactly to the persisted value. Verify the actual field, not
        // that stale notice, and do not claim a new persistence operation.
        if matches!(c, Command::ProfileEdit(_))
            && matches!(
                self.state(after)?,
                Root::Profile(Profile::Editing(Editing::Saved))
            )
            && e["fieldMatches"] == true
        {
            return Ok(OutcomeReport {
                kind: OutcomeKind::Success,
                label: "Profile field matches the requested value; no save inferred".into(),
            });
        }
        let r = legacy_ok(legacy(&after.facts, "verify", Some(c)))?;
        let (kind, label) = match r["outcome"].as_str() {
            Some("saved") if e["persisted"] == true => {
                (OutcomeKind::Success, "Saved and read back from Roots API")
            }
            Some("saved") => (
                OutcomeKind::Unknown,
                "Save displayed; persistence evidence is missing",
            ),
            Some("validation") => (
                OutcomeKind::Validation,
                "Roots displayed validation; correct the input",
            ),
            Some("recoverable_error") => (
                OutcomeKind::RecoverableError,
                "Roots retained a recoverable state",
            ),
            Some("reached") => (OutcomeKind::Success, "Expected Roots state observed"),
            _ => (OutcomeKind::Unknown, "No supported Roots outcome evidence"),
        };
        Ok(OutcomeReport {
            kind,
            label: label.into(),
        })
    }
    fn outcome_report(&self, o: &OutcomeReport) -> OutcomeReport {
        o.clone()
    }
    fn display(&self, o: &Observation<Facts>) -> Vec<DisplayFact> {
        vec![
            DisplayFact {
                label: "App source".into(),
                value: json!("d4008e3"),
            },
            DisplayFact {
                label: "Session".into(),
                value: serde_json::to_value(&o.facts.session).unwrap(),
            },
            DisplayFact {
                label: "Draft".into(),
                value: json!(o.facts.profile_draft || o.facts.journal_draft),
            },
        ]
    }
    fn authorize_recipe(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        if id != "journal-draft" {
            return Err(fail("unknown_recipe", "Unknown Roots recipe"));
        }
        if !matches!(o.facts.session, Session::Customer)
            || o.facts.journal_draft
            || o.facts.profile_draft
        {
            return Err(fail(
                "guard_rejected",
                "Recipe needs a signed-in customer without a draft",
            ));
        }
        self.authorize(o, &Command::Journal)
    }
}
fn main() -> std::io::Result<()> {
    browser_driver_engine::serve(Roots)
}
