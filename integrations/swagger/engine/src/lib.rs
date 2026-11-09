use daedlo_engine::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Operation {
    pub key: String,
    pub method: String,
    pub path: String,
    pub allow_execute: bool,
    pub allow_write: bool,
    pub auto_recipe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Profile {
    pub operations: Vec<Operation>,
    pub spec_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResponseFacts {
    pub operation: String,
    pub status: u16,
    pub matched: bool,
    pub documented: bool,
    pub schema_valid: bool,
    pub schema_supported: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Facts {
    pub docs_ready: bool,
    pub spec_matches: bool,
    #[serde(deserialize_with = "required_option")]
    pub selected: Option<String>,
    pub expanded: bool,
    pub try_enabled: bool,
    pub prepared: bool,
    pub input_valid: bool,
    pub target_allowed: bool,
    pub request_count: u64,
    #[serde(deserialize_with = "required_option")]
    pub response: Option<ResponseFacts>,
}

fn required_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    Unavailable,
    Catalog,
    Operation(OperationState),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationState {
    Selected,
    Prepared,
    Response,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Select { operation: String },
    Prepare { request: Value },
    Execute,
    Reset,
}

pub struct SwaggerModel {
    profile: Profile,
}

impl SwaggerModel {
    pub fn new(profile: Profile) -> Result<Self> {
        let invalid = || {
            DriverError::new(
                "invalid_profile",
                "Swagger profile is invalid or exceeds supported bounds",
            )
        };
        if !(1..=200).contains(&profile.operations.len())
            || profile.spec_digest.len() != 64
            || !profile
                .spec_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        let mut keys = BTreeSet::new();
        for operation in &profile.operations {
            if operation.method.is_empty()
                || operation.method.len() > 32
                || !operation
                    .method
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte))
                || !operation.path.starts_with('/')
                || operation.path.starts_with("//")
                || operation.path.len() > 240
                || operation.path.chars().any(|character| {
                    character.is_control()
                        || character.is_whitespace()
                        || ['?', '#', '\\'].contains(&character)
                })
                || operation.key != format!("{} {}", operation.method, operation.path)
                || !keys.insert(&operation.key)
            {
                return Err(invalid());
            }
        }
        Ok(Self { profile })
    }

    fn operation(&self, key: &str) -> Result<&Operation> {
        self.profile
            .operations
            .iter()
            .find(|operation| operation.key == key)
            .ok_or_else(|| {
                DriverError::new("unknown_operation", "Select a declared Swagger operation")
            })
    }

    fn ready(&self, observation: &Observation<Facts>) -> Result<()> {
        self.state(observation)?;
        if !observation.connected
            || !observation.facts.docs_ready
            || !observation.facts.spec_matches
        {
            return Err(DriverError::new(
                "command_disabled",
                "Swagger and its pinned schema must be available",
            ));
        }
        Ok(())
    }

    fn selected<'a>(&'a self, observation: &Observation<Facts>) -> Result<&'a Operation> {
        let key = observation.facts.selected.as_deref().ok_or_else(|| {
            DriverError::new("command_disabled", "Select a Swagger operation first")
        })?;
        self.operation(key)
    }

    fn executable(&self, operation: &Operation) -> bool {
        operation.allow_execute
            && [
                "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE",
            ]
            .contains(&operation.method.as_str())
            && (matches!(operation.method.as_str(), "GET" | "HEAD") || operation.allow_write)
    }

    fn recipe(&self, index: usize, operation: &Operation) -> Option<RecipeDescriptor> {
        // Automatic smoke recipes never introduce a write or supply private inputs.
        (operation.auto_recipe
            && operation.allow_execute
            && matches!(operation.method.as_str(), "GET" | "HEAD"))
        .then(|| RecipeDescriptor {
            id: format!("check_{index}"),
            label: format!("Check {}", operation.key),
            steps: vec![
                RecipeStep {
                    command: "select".into(),
                    params: json!({"operation":operation.key}),
                },
                RecipeStep {
                    command: "prepare".into(),
                    params: json!({"request":"{}"}),
                },
                RecipeStep {
                    command: "execute".into(),
                    params: json!({}),
                },
            ],
        })
    }
}

impl ApplicationModel for SwaggerModel {
    type Facts = Facts;
    type State = State;
    type Command = Command;
    type Outcome = OutcomeReport;

    fn descriptor(&self) -> ModelDescriptor {
        let options: Vec<_> = self
            .profile
            .operations
            .iter()
            .map(|operation| json!({"value":operation.key,"label":operation.key}))
            .collect();
        let recipes: Vec<_> = self
            .profile
            .operations
            .iter()
            .enumerate()
            .filter_map(|(index, operation)| self.recipe(index, operation))
            .collect();
        serde_json::from_value(json!({
            "id":"daedlo.swagger", "version":"1", "label":"Swagger API driver",
            "states":[
                {"id":"swagger","label":"Swagger","parent":null,"support":"supported"},
                {"id":"swagger.unavailable","label":"Unavailable","parent":"swagger","support":"supported"},
                {"id":"swagger.catalog","label":"Operation catalog","parent":"swagger","support":"supported"},
                {"id":"swagger.operation","label":"Operation","parent":"swagger","support":"supported"},
                {"id":"swagger.operation.selected","label":"Selected","parent":"swagger.operation","support":"supported"},
                {"id":"swagger.operation.prepared","label":"Prepared request","parent":"swagger.operation","support":"supported"},
                {"id":"swagger.operation.response","label":"Observed response","parent":"swagger.operation","support":"supported"}
            ],
            "commands":[
                {"id":"select","label":"Select operation","params":{"operation":{"type":"select","label":"Operation","required":true,"options":options}}},
                {"id":"prepare","label":"Prepare request","params":{"request":{"type":"text","label":"Request JSON: path, query, headers, body","required":true,"default":"{}","maxLength":32768}}},
                {"id":"execute","label":"Execute in Swagger","params":{}},
                {"id":"reset","label":"Return to catalog","params":{}}
            ],"recipes":recipes
        })).expect("validated Swagger profile produces a descriptor")
    }

    fn state(&self, observation: &Observation<Facts>) -> Result<State> {
        let facts = &observation.facts;
        let invalid = || {
            DriverError::new(
                "invalid_observation",
                "Swagger observation is inconsistent with the declared profile",
            )
        };
        if facts.request_count > 9_007_199_254_740_991 {
            return Err(invalid());
        }
        match facts.selected.as_deref() {
            Some(key) => {
                self.operation(key)?;
            }
            None if facts.expanded
                || facts.try_enabled
                || facts.prepared
                || facts.input_valid
                || facts.response.is_some() =>
            {
                return Err(invalid())
            }
            None => (),
        }
        if let Some(response) = &facts.response {
            if !(100..=599).contains(&response.status)
                || facts.selected.as_deref() != Some(response.operation.as_str())
            {
                return Err(invalid());
            }
        }
        if !observation.connected || !facts.docs_ready || !facts.spec_matches {
            return Ok(State::Unavailable);
        }
        if facts.selected.is_none() {
            return Ok(State::Catalog);
        }
        if facts.response.is_some() {
            return Ok(State::Operation(OperationState::Response));
        }
        if facts.expanded
            && facts.try_enabled
            && facts.prepared
            && facts.input_valid
            && facts.target_allowed
        {
            return Ok(State::Operation(OperationState::Prepared));
        }
        Ok(State::Operation(OperationState::Selected))
    }
    fn state_id(&self, state: &State) -> String {
        match state {
            State::Unavailable => "swagger.unavailable",
            State::Catalog => "swagger.catalog",
            State::Operation(OperationState::Selected) => "swagger.operation.selected",
            State::Operation(OperationState::Prepared) => "swagger.operation.prepared",
            State::Operation(OperationState::Response) => "swagger.operation.response",
        }
        .into()
    }

    fn decode_command(&self, id: &str, params: &Value) -> Result<Command> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Select {
            operation: String,
        }
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Prepare {
            request: String,
        }
        let invalid = || {
            DriverError::new(
                "invalid_params",
                "Swagger command parameters are invalid or unsupported",
            )
        };
        match id {
            "select" => {
                let select: Select =
                    serde_json::from_value(params.clone()).map_err(|_| invalid())?;
                self.operation(&select.operation)?;
                Ok(Command::Select {
                    operation: select.operation,
                })
            }
            "prepare" => {
                let prepare: Prepare =
                    serde_json::from_value(params.clone()).map_err(|_| invalid())?;
                if prepare.request.len() > 32768 {
                    return Err(invalid());
                }
                let request: Value =
                    serde_json::from_str(&prepare.request).map_err(|_| invalid())?;
                let object = request.as_object().ok_or_else(invalid)?;
                if object
                    .keys()
                    .any(|key| !["path", "query", "headers", "body"].contains(&key.as_str()))
                    || ["path", "query", "headers"]
                        .iter()
                        .any(|key| object.get(*key).is_some_and(|value| !value.is_object()))
                {
                    return Err(invalid());
                }
                Ok(Command::Prepare { request })
            }
            "execute" | "reset" => {
                if params.as_object().is_none_or(|object| !object.is_empty()) {
                    return Err(invalid());
                }
                Ok(if id == "execute" {
                    Command::Execute
                } else {
                    Command::Reset
                })
            }
            _ => Err(DriverError::new(
                "unknown_command",
                "Unknown Swagger command",
            )),
        }
    }

    fn authorize(&self, observation: &Observation<Facts>, command: &Command) -> Result<()> {
        self.ready(observation)?;
        match command {
            Command::Select { operation } => {
                self.operation(operation)?;
                Ok(())
            }
            Command::Reset => Ok(()),
            Command::Prepare { .. } => {
                self.selected(observation)?;
                if !observation.facts.expanded {
                    return Err(DriverError::new(
                        "command_disabled",
                        "Expand the selected Swagger operation first",
                    ));
                }
                Ok(())
            }
            Command::Execute => {
                if !self.executable(self.selected(observation)?) {
                    return Err(DriverError::new(
                        "command_disabled",
                        "This operation is not authorized for execution by the local profile",
                    ));
                }
                let facts = &observation.facts;
                if !facts.expanded
                    || !facts.try_enabled
                    || !facts.prepared
                    || !facts.input_valid
                    || !facts.target_allowed
                {
                    return Err(DriverError::new(
                        "command_disabled",
                        "Prepare valid inputs for the approved target before execution",
                    ));
                }
                Ok(())
            }
        }
    }

    fn verify(
        &self,
        before: &Observation<Facts>,
        after: &Observation<Facts>,
        command: &Command,
        _evidence: &Value,
    ) -> Result<OutcomeReport> {
        self.state(before)?;
        self.state(after)?;
        let report = |kind, label: &str| {
            Ok(OutcomeReport {
                kind,
                label: label.into(),
            })
        };
        if before.session != after.session
            || !after.connected
            || !after.facts.docs_ready
            || !after.facts.spec_matches
        {
            return report(
                OutcomeKind::Unknown,
                "Swagger session or schema changed; outcome is unknown",
            );
        }
        if !matches!(command, Command::Execute)
            && before.facts.request_count != after.facts.request_count
        {
            return report(
                OutcomeKind::Unknown,
                "An unexpected API request occurred while preparing Swagger",
            );
        }
        match command {
            Command::Select { operation }
                if after.facts.selected.as_ref() == Some(operation) && after.facts.expanded =>
            {
                report(OutcomeKind::Success, "Swagger operation selected")
            }
            Command::Prepare { .. }
                if before.facts.selected == after.facts.selected
                    && after.facts.expanded
                    && after.facts.try_enabled
                    && after.facts.prepared
                    && after.facts.input_valid
                    && after.facts.target_allowed =>
            {
                report(
                    OutcomeKind::Success,
                    "Swagger request prepared; no API request submitted",
                )
            }
            Command::Reset
                if after.facts.selected.is_none()
                    && !after.facts.expanded
                    && !after.facts.try_enabled
                    && !after.facts.prepared
                    && after.facts.response.is_none() =>
            {
                report(
                    OutcomeKind::Success,
                    "Returned to Swagger operation catalog",
                )
            }
            Command::Execute => {
                self.authorize(before, command)?;
                if before.facts.selected != after.facts.selected
                    || !after.facts.target_allowed
                    || before.facts.request_count.checked_add(1) != Some(after.facts.request_count)
                {
                    return report(
                        OutcomeKind::Unknown,
                        "Exactly one request to the selected operation was not confirmed",
                    );
                }
                let Some(response) = &after.facts.response else {
                    return report(
                        OutcomeKind::Unknown,
                        "No matching API response was observed",
                    );
                };
                if !response.matched
                    || !response.documented
                    || !response.schema_supported
                    || !response.schema_valid
                {
                    return report(
                        OutcomeKind::Unknown,
                        "API response did not establish the supported documented contract",
                    );
                }
                if (200..=299).contains(&response.status) {
                    report(
                        OutcomeKind::Success,
                        "Documented API response verified; persistence is not established",
                    )
                } else {
                    report(
                        OutcomeKind::RecoverableError,
                        "API returned a documented non-success response",
                    )
                }
            }
            _ => report(
                OutcomeKind::Unknown,
                "Expected Swagger state was not observed",
            ),
        }
    }
    fn outcome_report(&self, outcome: &OutcomeReport) -> OutcomeReport {
        outcome.clone()
    }

    fn command_available(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        match id {
            "select" | "reset" => self.ready(observation),
            "prepare" => self.authorize(observation, &Command::Prepare { request: json!({}) }),
            "execute" => self.authorize(observation, &Command::Execute),
            _ => Err(DriverError::new(
                "unknown_command",
                "Unknown Swagger command",
            )),
        }
    }

    fn authorize_recipe(&self, observation: &Observation<Facts>, id: &str) -> Result<()> {
        self.ready(observation)?;
        if !self
            .profile
            .operations
            .iter()
            .enumerate()
            .filter_map(|(index, operation)| self.recipe(index, operation))
            .any(|recipe| recipe.id == id)
        {
            return Err(DriverError::new(
                "unknown_recipe",
                "Unknown or unauthorized Swagger recipe",
            ));
        }
        Ok(())
    }

    fn display(&self, observation: &Observation<Facts>) -> Vec<DisplayFact> {
        let mut display = vec![DisplayFact {
            label: "Pinned schema".into(),
            value: json!(if observation.facts.spec_matches {
                "Matched"
            } else {
                "Unavailable or changed"
            }),
        }];
        if let Some(operation) = observation
            .facts
            .selected
            .as_deref()
            .and_then(|key| self.operation(key).ok())
        {
            display.push(DisplayFact {
                label: "Operation".into(),
                value: json!(operation.key),
            });
            display.push(DisplayFact {
                label: "Execution policy".into(),
                value: json!(if self.executable(operation) {
                    "Explicitly enabled"
                } else {
                    "Inspect only"
                }),
            });
        }
        if let Some(response) = &observation.facts.response {
            display.push(DisplayFact {
                label: "HTTP response".into(),
                value: json!(response.status),
            });
        }
        display
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> Profile {
        serde_json::from_value(json!({
            "specDigest":"a".repeat(64),
            "operations":[
                {"key":"GET /api/hello","method":"GET","path":"/api/hello","allowExecute":true,"allowWrite":false,"autoRecipe":true},
                {"key":"POST /api/items","method":"POST","path":"/api/items","allowExecute":true,"allowWrite":false,"autoRecipe":false},
                {"key":"GET /api/private","method":"GET","path":"/api/private","allowExecute":false,"allowWrite":false,"autoRecipe":false}
            ]
        })).unwrap()
    }
    fn model() -> SwaggerModel {
        SwaggerModel::new(profile()).unwrap()
    }
    fn observation() -> Observation<Facts> {
        serde_json::from_value(json!({"connected":true,"session":"fixture","facts":{
            "docsReady":true,"specMatches":true,"selected":"GET /api/hello","expanded":true,
            "tryEnabled":true,"prepared":true,"inputValid":true,"targetAllowed":true,
            "requestCount":4,"response":null
        }}))
        .unwrap()
    }
    fn response() -> Observation<Facts> {
        let mut after = observation();
        after.facts.request_count += 1;
        after.facts.response = Some(ResponseFacts {
            operation: "GET /api/hello".into(),
            status: 200,
            matched: true,
            documented: true,
            schema_valid: true,
            schema_supported: true,
        });
        after
    }
    fn verified(after: &Observation<Facts>) -> OutcomeKind {
        model()
            .verify(&observation(), after, &Command::Execute, &json!({}))
            .unwrap()
            .kind
    }

    #[test]
    fn profile_requires_explicit_policy_and_exact_operation_identity() {
        let mut p = profile();
        p.operations[0].key = "POST /elsewhere".into();
        assert!(SwaggerModel::new(p).is_err());
        let mut value = serde_json::to_value(profile()).unwrap();
        value["operations"][0]
            .as_object_mut()
            .unwrap()
            .remove("allowExecute");
        assert!(serde_json::from_value::<Profile>(value).is_err());
    }
    #[test]
    fn profile_rejects_duplicate_empty_or_unsafe_metadata() {
        let mut p = profile();
        p.operations.push(p.operations[0].clone());
        assert!(SwaggerModel::new(p).is_err());
        let mut p = profile();
        p.operations.clear();
        assert!(SwaggerModel::new(p).is_err());
        let mut p = profile();
        p.operations[0].path = "/api/hello\nsecret".into();
        assert!(SwaggerModel::new(p).is_err());
        let mut p = profile();
        p.spec_digest = "private-token".into();
        assert!(SwaggerModel::new(p).is_err());
    }
    #[test]
    fn descriptor_is_valid_and_has_only_authorized_read_recipes() {
        let model = model();
        let descriptor = model.descriptor();
        assert_eq!(descriptor.commands.len(), 4);
        assert_eq!(descriptor.recipes.len(), 1);
        assert_eq!(descriptor.recipes[0].id, "check_0");
        assert_eq!(descriptor.recipes[0].steps[2].command, "execute");
        assert_eq!(
            Engine::new(model).dispatch(json!({"protocol":1,"id":1,"op":"hello"}))["ok"],
            true
        );
    }
    #[test]
    fn states_are_derived_from_observed_readiness() {
        let model = model();
        let mut obs = observation();
        assert_eq!(
            model.state(&obs).unwrap(),
            State::Operation(OperationState::Prepared)
        );
        obs.facts.prepared = false;
        obs.facts.input_valid = false;
        assert_eq!(
            model.state(&obs).unwrap(),
            State::Operation(OperationState::Selected)
        );
        obs.facts.selected = None;
        obs.facts.expanded = false;
        obs.facts.try_enabled = false;
        assert_eq!(model.state(&obs).unwrap(), State::Catalog);
        obs.facts.docs_ready = false;
        assert_eq!(model.state(&obs).unwrap(), State::Unavailable);
        assert_eq!(
            model.state(&response()).unwrap(),
            State::Operation(OperationState::Response)
        );
    }
    #[test]
    fn unknown_or_contradictory_facts_do_not_become_success() {
        let model = model();
        let mut obs = observation();
        obs.facts.selected = Some("GET /unknown".into());
        assert!(model.state(&obs).is_err());
        let mut obs = observation();
        obs.facts.selected = None;
        assert!(model.state(&obs).is_err());
        let mut value = serde_json::to_value(observation()).unwrap();
        value["facts"]
            .as_object_mut()
            .unwrap()
            .remove("targetAllowed");
        assert!(serde_json::from_value::<Observation<Facts>>(value).is_err());
        let mut value = serde_json::to_value(observation()).unwrap();
        value["facts"]["extra"] = json!(true);
        assert!(serde_json::from_value::<Observation<Facts>>(value).is_err());
    }
    #[test]
    fn request_decoding_is_strict_and_bounded() {
        let model = model();
        assert_eq!(
            model
                .decode_command("prepare", &json!({"request":"{\"query\":{\"limit\":3}}"}))
                .unwrap(),
            Command::Prepare {
                request: json!({"query":{"limit":3}})
            }
        );
        for params in [
            json!({"request":"[]"}),
            json!({"request":"{\"unexpected\":1}"}),
            json!({"request":"{\"query\":[]}"}),
            json!({"request":"bad private input"}),
            json!({"request":"{}","extra":true}),
            json!({"request":" ".repeat(32769)}),
        ] {
            assert!(model.decode_command("prepare", &params).is_err());
        }
        assert!(model
            .decode_command("execute", &json!({"bypass":true}))
            .is_err());
        assert!(model
            .decode_command("select", &json!({"operation":"GET /unknown"}))
            .is_err());
        assert!(model.decode_command("unknown", &json!({})).is_err());
    }
    #[test]
    fn execution_requires_explicit_read_or_write_permission() {
        let model = model();
        let mut obs = observation();
        assert!(model.authorize(&obs, &Command::Execute).is_ok());
        obs.facts.selected = Some("POST /api/items".into());
        assert!(model.authorize(&obs, &Command::Execute).is_err());
        obs.facts.selected = Some("GET /api/private".into());
        assert!(model.authorize(&obs, &Command::Execute).is_err());
        let mut p = profile();
        p.operations[1].allow_write = true;
        obs.facts.selected = Some("POST /api/items".into());
        assert!(SwaggerModel::new(p)
            .unwrap()
            .authorize(&obs, &Command::Execute)
            .is_ok());
    }
    #[test]
    fn execution_refuses_unprepared_or_stale_target() {
        for field in [
            "docsReady",
            "specMatches",
            "expanded",
            "tryEnabled",
            "prepared",
            "inputValid",
            "targetAllowed",
        ] {
            let mut value = serde_json::to_value(observation()).unwrap();
            value["facts"][field] = json!(false);
            let obs: Observation<Facts> = serde_json::from_value(value).unwrap();
            assert!(
                model().authorize(&obs, &Command::Execute).is_err(),
                "{field}"
            );
        }
        let mut obs = observation();
        obs.connected = false;
        assert!(model().authorize(&obs, &Command::Execute).is_err());
    }
    #[test]
    fn only_fresh_matched_documented_valid_response_succeeds() {
        assert_eq!(verified(&response()), OutcomeKind::Success);
        let mut after = response();
        after.facts.request_count = 4;
        assert_eq!(verified(&after), OutcomeKind::Unknown);
        let mut after = response();
        after.facts.request_count = 6;
        assert_eq!(verified(&after), OutcomeKind::Unknown);
        let mut after = response();
        after.facts.response = None;
        assert_eq!(verified(&after), OutcomeKind::Unknown);
        for field in ["matched", "documented", "schemaValid", "schemaSupported"] {
            let mut value = serde_json::to_value(response()).unwrap();
            value["facts"]["response"][field] = json!(false);
            assert_eq!(
                verified(&serde_json::from_value(value).unwrap()),
                OutcomeKind::Unknown,
                "{field}"
            );
        }
    }
    #[test]
    fn response_is_bound_to_session_target_and_operation() {
        let mut after = response();
        after.session = "other".into();
        assert_eq!(verified(&after), OutcomeKind::Unknown);
        let mut after = response();
        after.facts.selected = Some("GET /api/private".into());
        assert!(model()
            .verify(&observation(), &after, &Command::Execute, &json!({}))
            .is_err());
        let mut after = response();
        after.facts.target_allowed = false;
        assert_eq!(verified(&after), OutcomeKind::Unknown);
        let mut after = response();
        after.facts.response.as_mut().unwrap().operation = "GET /api/private".into();
        assert!(model().state(&after).is_err());
    }
    #[test]
    fn documented_http_error_is_not_success() {
        let mut after = response();
        after.facts.response.as_mut().unwrap().status = 401;
        assert_eq!(verified(&after), OutcomeKind::RecoverableError);
        after.facts.response.as_mut().unwrap().status = 503;
        assert_eq!(verified(&after), OutcomeKind::RecoverableError);
    }
    #[test]
    fn setup_cannot_claim_success_after_an_unexpected_request() {
        let model = model();
        let before = observation();
        let after = response();
        assert_eq!(
            model
                .verify(
                    &before,
                    &after,
                    &Command::Select {
                        operation: "GET /api/hello".into()
                    },
                    &json!({})
                )
                .unwrap()
                .kind,
            OutcomeKind::Unknown
        );
        assert_eq!(
            model
                .verify(
                    &before,
                    &after,
                    &Command::Prepare { request: json!({}) },
                    &json!({})
                )
                .unwrap()
                .kind,
            OutcomeKind::Unknown
        );
    }
    #[test]
    fn recipe_guards_refuse_unknown_recipe_or_unavailable_schema() {
        let model = model();
        let mut obs = observation();
        assert!(model.authorize_recipe(&obs, "check_0").is_ok());
        assert!(model.authorize_recipe(&obs, "check_1").is_err());
        obs.facts.spec_matches = false;
        assert!(model.authorize_recipe(&obs, "check_0").is_err());
    }
    #[test]
    fn errors_and_display_never_echo_request_values() {
        let model = model();
        let error = model
            .decode_command("prepare", &json!({"request":"PRIVATE_SENTINEL"}))
            .unwrap_err();
        assert!(!error.to_string().contains("PRIVATE_SENTINEL"));
        let display = serde_json::to_string(&model.display(&observation())).unwrap();
        assert!(!display.contains("fixture"));
    }

    #[test]
    fn absent_nullable_facts_are_not_silently_defaulted() {
        for field in ["selected", "response"] {
            let mut value = serde_json::to_value(observation()).unwrap();
            value["facts"].as_object_mut().unwrap().remove(field);
            assert!(
                serde_json::from_value::<Observation<Facts>>(value).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn protocol_refuses_revision_after_input_or_session_change() {
        let engine = Engine::new(model());
        let observed = engine
            .dispatch(json!({"protocol":1,"id":1,"op":"observe","observation":observation()}));
        assert_eq!(observed["ok"], true);
        for session_change in [false, true] {
            let mut changed = observation();
            if session_change {
                changed.session = "other-session".into();
            } else {
                changed.facts.prepared = false;
            }
            let result = engine.dispatch(json!({"protocol":1,"id":2,"op":"command","observation":changed,"fingerprint":observed["fingerprint"],"command":"execute","params":{}}));
            assert_eq!(result["ok"], false);
            assert_eq!(result["error_code"], "stale_observation");
        }
    }

    #[test]
    fn observed_response_leaf_does_not_assert_success() {
        let engine = Engine::new(model());
        let mut after = response();
        after.facts.response.as_mut().unwrap().schema_valid = false;
        let observed =
            engine.dispatch(json!({"protocol":1,"id":1,"op":"observe","observation":after}));
        assert_eq!(observed["state"]["id"], "swagger.operation.response");
        let result = engine.dispatch(json!({"protocol":1,"id":2,"op":"verify","before":observation(),"observation":after,"command":"execute","params":{},"evidence":{}}));
        assert_eq!(result["ok"], true);
        assert_eq!(result["outcome"]["kind"], "unknown");
    }

    #[test]
    fn custom_http_methods_are_discoverable_but_never_executable() {
        for method in ["QUERY", "CUSTOM-METHOD"] {
            let mut profile = profile();
            let operation = &mut profile.operations[1];
            operation.method = method.into();
            operation.key = format!("{method} {}", operation.path);
            operation.allow_write = true;
            operation.auto_recipe = true;
            let key = operation.key.clone();
            let model =
                SwaggerModel::new(profile).expect("Valid custom HTTP methods remain discoverable");
            let mut observed = observation();
            observed.facts.selected = Some(key.clone());
            assert!(model
                .decode_command("select", &json!({"operation":key}))
                .is_ok());
            assert!(model.authorize(&observed, &Command::Execute).is_err());
            assert_eq!(model.descriptor().recipes.len(), 1);
        }
        for method in ["", "BAD METHOD", "NEW\nMETHOD"] {
            let mut profile = profile();
            profile.operations[1].method = method.into();
            profile.operations[1].key = format!("{method} /api/items");
            assert!(SwaggerModel::new(profile).is_err());
        }
    }
}
