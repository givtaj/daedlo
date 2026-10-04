use browser_driver_engine::{
    ApplicationModel, DisplayFact, DriverError, ModelDescriptor, Observation, OutcomeKind,
    OutcomeReport, Result,
};
use roots_qa_driver::ux::{
    Calendar, Editing, ExperienceEdit, ExperienceEditRecovery, Home, Journal, Profile, Root,
    Signin, Strain, Validation,
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
    Strains,
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
    EditSave,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    edit: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    strains: Option<Value>,
    fixture: Fixture,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    ready: bool,
    disposable: bool,
}

#[derive(Clone)]
struct Command {
    id: String,
    params: Value,
}
struct RootsEdit;
fn fail(code: &str, message: impl Into<String>) -> DriverError {
    DriverError::new(code, message)
}
fn source_facts(f: &Facts) -> Value {
    let mut value = serde_json::to_value(f).expect("facts serialize");
    value.as_object_mut().unwrap().remove("fixture");
    value
}
fn checked(value: Value) -> Result<Value> {
    if value["ok"] == true {
        Ok(value)
    } else {
        Err(fail(
            value["error_code"].as_str().unwrap_or("customer_rejected"),
            value["error"]
                .as_str()
                .unwrap_or("Roots model rejected observation"),
        ))
    }
}
fn source(f: &Facts, op: &str, command: Option<&Command>) -> Value {
    let facts = source_facts(f);
    let observed = roots_qa_driver::respond(json!({"op":"observe","observation":facts}));
    let mut request =
        json!({"op":op,"observation":facts,"fingerprint":observed["state"]["fingerprint"]});
    if let Some(c) = command {
        request["command"] = json!(c.id);
        request["params"] = c.params.clone();
        // The package guards and checks the canonical plan. The customer bridge
        // also asks its original Rust model to authorize internal evidence steps.
        // The Node adapter requires an active canonical recipe before these run.
        if INTERNAL.contains(&c.id.as_str()) || c.params["entry_id"] == "@created" {
            for (recipe, _) in RECIPES {
                if let Some((index, _)) = source_plan(recipe)
                    .as_array()
                    .unwrap()
                    .iter()
                    .enumerate()
                    .find(|(_, step)| step["command"] == c.id && step["params"] == c.params)
                {
                    request["recipe"] = json!(recipe);
                    request["step"] = json!(index);
                    request["recipe_session_key"] = json!(f.session_key);
                    break;
                }
            }
        }
    }
    roots_qa_driver::respond(request)
}
const RECIPES: &[(&str, &str)] = &[
    ("edit-save", "Correct an existing experience"),
    ("edit-cancel-retained", "Keep then cancel an edit draft"),
    ("edit-lost-response-retry", "Reconcile a lost edit response"),
    (
        "edit-persisted",
        "Verify edit reload and restart persistence",
    ),
];
const INTERNAL: &[&str] = &[
    "checkpoint",
    "assert",
    "fault_on",
    "fault_off",
    "restart_api",
];
// Plans are sourced through the customer's public Rust API, never duplicated in
// JavaScript. This synthetic read-only observation only extracts the catalogue.
fn source_plan(id: &str) -> Value {
    let facts = json!({"connected":true,"session":"customer","session_key":"catalogue-only",
        "screen":"journal","pending":"none","available_controls":["journal","edit_open"],
        "capabilities":{"restart_api":true,"shared_compare":false,"route_faults":true}});
    let observed = roots_qa_driver::respond(json!({"op":"observe","observation":facts}));
    let response = roots_qa_driver::respond(json!({"op":"recipe","recipe":id,"observation":facts,
        "fingerprint":observed["state"]["fingerprint"]}));
    assert_eq!(response["ok"], true, "Pinned Roots recipe missing");
    response["plan"].clone()
}
// Explicit bridge from the pinned legacy model to stable public wire IDs. No
// Debug formatting is emitted in the new descriptor or observation contract.
fn states() -> Vec<(&'static str, &'static str, Root)> {
    vec![
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Loading))",
            "journal.edit.loading",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Loading)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Ready))",
            "journal.edit.ready",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Ready)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Draft))",
            "journal.edit.draft",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Draft)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Saving))",
            "journal.edit.saving",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Saving)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Saved))",
            "journal.edit.saved",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Saved)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Validation))",
            "journal.edit.validation",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Validation)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Conflict))",
            "journal.edit.conflict",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Conflict)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Unavailable))",
            "journal.edit.unavailable",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Unavailable)),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(ExperienceEditRecovery::Load)))",
            "journal.edit.recovery.load",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(
                ExperienceEditRecovery::Load,
            ))),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(ExperienceEditRecovery::Choices)))",
            "journal.edit.recovery.choices",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(
                ExperienceEditRecovery::Choices,
            ))),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(ExperienceEditRecovery::Save)))",
            "journal.edit.recovery.save",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(
                ExperienceEditRecovery::Save,
            ))),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(ExperienceEditRecovery::UncertainSave)))",
            "journal.edit.recovery.uncertain_save",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(
                ExperienceEditRecovery::UncertainSave,
            ))),
        ),
        (
            "Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(ExperienceEditRecovery::Refresh)))",
            "journal.edit.recovery.refresh",
            Root::Journal(Journal::EditExperience(ExperienceEdit::Recovery(
                ExperienceEditRecovery::Refresh,
            ))),
        ),
        (
            "Root::Journal(Journal::SessionChanged)",
            "journal.session_changed",
            Root::Journal(Journal::SessionChanged),
        ),
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
impl ApplicationModel for RootsEdit {
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
            "journal.edit",
            "journal.edit.recovery",
        ];
        let mut state_values: Vec<Value> = groups
            .iter()
            .map(|id| {
                json!({"id":id,"label":id,
            "parent":id.rsplit_once('.').map(|(p,_)|p),"support":"supported"})
            })
            .collect();
        state_values.extend(states().into_iter().map(|(_,id,_)| json!({"id":id,
            "label":id.rsplit('.').next(),"parent":id.rsplit_once('.').map(|(p,_)|p),"support":"supported"})));
        let mut commands = vec![];
        for (id, label) in [
            ("home", "Home"),
            ("profile", "Profile"),
            ("journal", "Smoking Journal"),
            ("signin", "Sign in"),
            ("signout", "Sign out"),
            ("log_experience", "Log experience"),
            ("journal_save", "Save experience"),
            ("journal_cancel", "Cancel experience"),
            ("edit_save", "Save changes"),
            ("edit_retry_save", "Retry same edit"),
            ("edit_cancel", "Cancel edit"),
            ("reload", "Reload Roots"),
            ("restart_api", "Recipe: restart owned API"),
            ("fault_off", "Recipe: clear owned fault"),
        ] {
            let mut value = json!({"id":id,"label":label,"params":{}});
            if ["signin", "signout"].contains(&id) {
                value["changesSession"] = json!(true);
            }
            commands.push(value);
        }
        let text = |label: &str, required: bool, max: usize| json!({"type":"text","label":label,"required":required,"maxLength":max});
        let rating = json!({"type":"select","label":"Rating","options":[{"value":"","label":"Unrated"},{"value":"1","label":"1"},{"value":"2","label":"2"},{"value":"3","label":"3"},{"value":"4","label":"4"},{"value":"5","label":"5"}]});
        for (id, label) in [
            ("journal_fill", "Fill experience"),
            ("edit_fill", "Correct experience"),
        ] {
            commands.push(json!({"id":id,"label":label,"params":{
                "date":text("Date",false,32),"notes":text("Notes",id=="journal_fill",4001),
                "rating":rating,"strain":text("Strain ID",false,128)}}));
        }
        commands.push(json!({"id":"edit_open","label":"Edit exact entry","params":{"entry_id":text("Entry ID",true,128)}}));
        for (id, field, label, options) in [
            (
                "checkpoint",
                "name",
                "Recipe checkpoint",
                vec!["edit_before"],
            ),
            (
                "assert",
                "name",
                "Recipe assertion",
                vec![
                    "saved_once",
                    "edit_draft_retained",
                    "edit_cancelled",
                    "edit_uncertain",
                    "edit_saved",
                    "edit_reloaded",
                    "edit_persisted",
                ],
            ),
            (
                "fault_on",
                "mode",
                "Recipe fault",
                vec!["edit_lost_response"],
            ),
        ] {
            commands.push(json!({"id":id,"label":label,"params":{field:{"type":"select","label":label,"required":true,
                "options":options.iter().map(|value|json!({"value":value,"label":value})).collect::<Vec<_>>()}}}));
        }
        let recipes: Vec<Value> = RECIPES
            .iter()
            .map(|(id, label)| json!({"id":id,"label":label,"steps":source_plan(id)}))
            .collect();
        serde_json::from_value(json!({"id":"roots-edit","version":"96275b5-journal-edit-v1",
            "label":"Roots isolated Journal edit consumer","states":state_values,"commands":commands,"recipes":recipes})).expect("static descriptor")
    }
    fn state(&self, o: &Observation<Facts>) -> Result<Root> {
        if o.connected != o.facts.connected || o.session != o.facts.session_key {
            return Err(fail(
                "invalid_observation",
                "Envelope contradicts Roots facts",
            ));
        }
        let observed = checked(source(&o.facts, "observe", None))?;
        let label = observed["state"]["root"]
            .as_str()
            .ok_or_else(|| fail("unknown_state", "Roots destination is unknown"))?;
        states()
            .into_iter()
            .find(|(l, _, _)| *l == label)
            .map(|(_, _, s)| s)
            .ok_or_else(|| {
                fail(
                    "unknown_state",
                    "Roots destination is outside extracted edit coverage",
                )
            })
    }
    fn state_id(&self, state: &Root) -> String {
        states()
            .into_iter()
            .find(|(_, _, r)| r == state)
            .map(|(_, id, _)| id.to_string())
            .unwrap_or_else(|| "unknown".into())
    }
    fn decode_command(&self, id: &str, params: &Value) -> Result<Command> {
        if !self.descriptor().commands.iter().any(|c| c.id == id) {
            return Err(fail("unknown_command", "Unsupported Roots edit command"));
        }
        Ok(Command {
            id: id.into(),
            params: params.clone(),
        })
    }
    fn command_available(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        if INTERNAL.contains(&id) {
            if !o.facts.fixture.ready || !o.facts.fixture.disposable {
                return Err(fail(
                    "fixture_not_ready",
                    "Verified disposable fixture data is required",
                ));
            }
            if id == "restart_api" && !o.facts.capabilities.restart_api {
                return Err(fail(
                    "fixture_not_ready",
                    "Owned API restart is unavailable",
                ));
            }
            if ["fault_on", "fault_off"].contains(&id) && !o.facts.capabilities.route_faults {
                return Err(fail(
                    "fixture_not_ready",
                    "Disposable route faults are unavailable",
                ));
            }
            return Ok(());
        }
        let observed = checked(source(&o.facts, "observe", None))?;
        let command = observed["commands"]
            .as_array()
            .and_then(|cs| cs.iter().find(|c| c["id"] == id))
            .ok_or_else(|| {
                fail(
                    "guard_rejected",
                    "Required customer control is not observed",
                )
            })?;
        if command["enabled"] == true {
            Ok(())
        } else {
            Err(fail(
                "guard_rejected",
                command["reason"]
                    .as_str()
                    .unwrap_or("Roots command unavailable"),
            ))
        }
    }
    fn authorize(&self, o: &Observation<Facts>, c: &Command) -> Result<()> {
        checked(source(&o.facts, "command", Some(c))).map(|_| ())
    }
    fn authorize_recipe(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        if !RECIPES.iter().any(|(known, _)| *known == id) {
            return Err(fail("unknown_recipe", "Unsupported edit recipe"));
        }
        if !o.facts.fixture.ready || !o.facts.fixture.disposable {
            return Err(fail(
                "fixture_not_ready",
                "Verify the disposable customer fixture and data before running recipes",
            ));
        }
        let facts = source_facts(&o.facts);
        let observed = roots_qa_driver::respond(json!({"op":"observe","observation":facts}));
        checked(roots_qa_driver::respond(
            json!({"op":"recipe","recipe":id,"observation":facts,
            "fingerprint":observed["state"]["fingerprint"]}),
        ))
        .map(|_| ())
    }
    fn verify(
        &self,
        _: &Observation<Facts>,
        after: &Observation<Facts>,
        c: &Command,
        e: &Value,
    ) -> Result<OutcomeReport> {
        let response = checked(source(&after.facts, "verify", Some(c)))?;
        let (kind, label) = match response["outcome"].as_str() {
            Some("saved") if e["persisted"] == true => (
                OutcomeKind::Success,
                "Matching save receipt and fresh Roots API read confirmed",
            ),
            Some("saved") => (
                OutcomeKind::Unknown,
                "Saved state observed; matching persistence evidence is missing",
            ),
            Some("uncertain") if e["expectedUncertain"] == true => (
                OutcomeKind::Success,
                "Expected uncertain recovery observed; save remains unconfirmed",
            ),
            Some("uncertain") => (
                OutcomeKind::Unknown,
                "Save remains uncertain; reconcile the same operation",
            ),
            Some("validation") => (OutcomeKind::Validation, "Roots displayed validation"),
            Some(
                "rejected"
                | "recoverable_error"
                | "conflict"
                | "saved_refresh_failed"
                | "unavailable",
            ) => (
                OutcomeKind::RecoverableError,
                "Roots displayed a recoverable outcome; inspect application evidence",
            ),
            Some("reached") if c.id == "assert" && e["asserted"] != c.params["name"] => (
                OutcomeKind::Unknown,
                "Customer assertion evidence is missing",
            ),
            Some("reached") if e["restartPersisted"] == true => (
                OutcomeKind::Success,
                "Exact edit survived independent reload and owned API restart",
            ),
            Some("reached") if e["cancelledUnchanged"] == true => (
                OutcomeKind::Success,
                "Edit cancelled; original entry and version unchanged",
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
                value: json!("96275b5 + frozen Journal edit overlay"),
            },
            DisplayFact {
                label: "Fixture ready".into(),
                value: json!(o.facts.fixture.ready),
            },
            DisplayFact {
                label: "Session".into(),
                value: serde_json::to_value(&o.facts.session).unwrap(),
            },
        ]
    }
}
fn main() -> std::io::Result<()> {
    browser_driver_engine::serve(RootsEdit)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn observation() -> Observation<Facts> {
        serde_json::from_value(json!({"connected":true,"session":"test-session","facts":{
            "connected":true,"session":"customer","session_key":"test-session","screen":"journal",
            "profile_draft":false,"journal_draft":false,"strain_draft":false,"form_open":false,
            "pending":"none","error":"none","saved":false,"selected_day":true,"mobile":false,
            "field_fingerprint":"test-fields","draft_token":"","history_count":1,
            "available_controls":["journal","edit_open","log_experience"],
            "capabilities":{"restart_api":true,"shared_compare":false,"route_faults":true},
            "fixture":{"ready":true,"disposable":true}}}))
        .unwrap()
    }
    #[test]
    fn plans_are_exactly_the_four_customer_rust_plans() {
        let descriptor = RootsEdit.descriptor();
        assert_eq!(descriptor.recipes.len(), 4);
        for recipe in descriptor.recipes {
            assert_eq!(
                serde_json::to_value(recipe.steps).unwrap(),
                source_plan(&recipe.id)
            );
        }
    }
    #[test]
    fn missing_fixture_or_owned_capability_blocks_recipe_before_plan() {
        let mut o = observation();
        o.facts.fixture.ready = false;
        for (id, _) in RECIPES {
            assert!(RootsEdit.authorize_recipe(&o, id).is_err());
        }
        o.facts.fixture.ready = true;
        o.facts.capabilities.restart_api = false;
        o.facts.capabilities.route_faults = false;
        assert!(RootsEdit.authorize_recipe(&o, "edit-save").is_ok());
        assert!(RootsEdit.authorize_recipe(&o, "edit-persisted").is_err());
        assert!(
            RootsEdit
                .authorize_recipe(&o, "edit-lost-response-retry")
                .is_err()
        );
        assert!(RootsEdit.authorize_recipe(&o, "shared-selected").is_err());
    }
    #[test]
    fn assertion_cannot_infer_success_from_page_shape() {
        let o = observation();
        let c = Command {
            id: "assert".into(),
            params: json!({"name":"edit_saved"}),
        };
        assert_eq!(
            RootsEdit.verify(&o, &o, &c, &json!({})).unwrap().kind,
            OutcomeKind::Unknown
        );
        assert_eq!(
            RootsEdit
                .verify(&o, &o, &c, &json!({"asserted":"edit_saved"}))
                .unwrap()
                .kind,
            OutcomeKind::Success
        );
    }
    #[test]
    fn uncertainty_is_not_a_confirmed_save_even_for_expected_failure_step() {
        let mut o = observation();
        o.facts.edit = Some(
            json!({"active":true,"form_open":true,"target_id":"41","profile_id":"12",
            "current_profile_id":"12","base_version":1,"original_fields_key":"old","draft_fields_key":"new",
            "operation_token":"private-op","operation_target":"41","operation_profile":"12",
            "operation_base_version":1,"operation_fields_key":"new","save_status":0}),
        );
        let c = Command {
            id: "edit_save".into(),
            params: json!({}),
        };
        assert_eq!(
            RootsEdit.state_id(&RootsEdit.state(&o).unwrap()),
            "journal.edit.recovery.uncertain_save"
        );
        let ordinary = RootsEdit.verify(&o, &o, &c, &json!({})).unwrap();
        assert_eq!(ordinary.kind, OutcomeKind::Unknown);
        let expected = RootsEdit
            .verify(&o, &o, &c, &json!({"expectedUncertain":true}))
            .unwrap();
        assert_eq!(expected.kind, OutcomeKind::Success);
        assert!(expected.label.contains("save remains unconfirmed"));
    }
    #[test]
    fn internal_steps_require_exact_canonical_parameters() {
        let o = observation();
        assert!(
            RootsEdit
                .authorize(
                    &o,
                    &Command {
                        id: "assert".into(),
                        params: json!({"name":"forged"})
                    }
                )
                .is_err()
        );
        assert!(
            RootsEdit
                .authorize(
                    &o,
                    &Command {
                        id: "fault_on".into(),
                        params: json!({"mode":"history_load"})
                    }
                )
                .is_err()
        );
    }
}
