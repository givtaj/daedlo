// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
//! Typed customer models behind the Daedlo JSON Lines protocol.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

mod protocol;
pub use protocol::{serve, Engine};

pub const PROTOCOL_VERSION: u64 = 1;
pub type Result<T> = std::result::Result<T, DriverError>;

#[derive(Debug, Clone)]
pub struct DriverError {
    pub code: String,
    pub message: String,
}

impl DriverError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for DriverError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for DriverError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Observation<F> {
    pub connected: bool,
    pub session: String,
    pub facts: F,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDescriptor {
    pub id: String,
    pub version: String,
    pub label: String,
    pub states: Vec<StateDescriptor>,
    pub commands: Vec<CommandDescriptor>,
    pub recipes: Vec<RecipeDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateDescriptor {
    pub id: String,
    pub label: String,
    pub parent: Option<String>,
    pub support: Support,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Support {
    Supported,
    Planned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandDescriptor {
    pub id: String,
    pub label: String,
    pub params: BTreeMap<String, Parameter>,
    #[serde(
        default,
        rename = "changesSession",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub changes_session: bool,
    #[serde(
        default,
        rename = "recipeOnly",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub recipe_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Parameter {
    #[serde(rename = "type")]
    pub kind: ParameterType,
    pub label: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(default, rename = "maxLength", skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParameterType {
    Text,
    /// String input masked and cleared after manual submission by the viewer.
    /// Defaults and recipe literals are still public descriptor metadata.
    Password,
    Number,
    Boolean,
    Select,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeDescriptor {
    pub id: String,
    pub label: String,
    pub steps: Vec<RecipeStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeStep {
    pub command: String,
    pub params: Value,
}

/// Canonical execution context, separate from application observation identity.
/// The stateless engine validates this context; the runtime owns the active run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeContext {
    pub recipe: String,
    pub step: usize,
    pub session: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplayFact {
    pub label: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutcomeKind {
    Success,
    Validation,
    RecoverableError,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeReport {
    pub kind: OutcomeKind,
    pub label: String,
}

/// Customers own semantic states, actions and outcomes. Implementations must not
/// include secrets in descriptor labels, display facts, outcomes or errors.
pub trait ApplicationModel {
    type Facts: Serialize + DeserializeOwned;
    type State;
    type Command;
    type Outcome;

    fn descriptor(&self) -> ModelDescriptor;
    fn state(&self, observation: &Observation<Self::Facts>) -> Result<Self::State>;
    fn state_id(&self, state: &Self::State) -> String;
    fn decode_command(&self, id: &str, params: &Value) -> Result<Self::Command>;
    fn authorize(
        &self,
        observation: &Observation<Self::Facts>,
        command: &Self::Command,
    ) -> Result<()>;
    fn verify(
        &self,
        before: &Observation<Self::Facts>,
        after: &Observation<Self::Facts>,
        command: &Self::Command,
        evidence: &Value,
    ) -> Result<Self::Outcome>;
    fn outcome_report(&self, outcome: &Self::Outcome) -> OutcomeReport;
    /// Called only after the engine checks canonical step parameters and session.
    fn authorize_scoped(
        &self,
        observation: &Observation<Self::Facts>,
        command: &Self::Command,
        _context: Option<&RecipeContext>,
    ) -> Result<()> {
        self.authorize(observation, command)
    }
    fn verify_scoped(
        &self,
        before: &Observation<Self::Facts>,
        after: &Observation<Self::Facts>,
        command: &Self::Command,
        evidence: &Value,
        _context: Option<&RecipeContext>,
    ) -> Result<Self::Outcome> {
        self.verify(before, after, command, evidence)
    }
    fn display(&self, _observation: &Observation<Self::Facts>) -> Vec<DisplayFact> {
        vec![]
    }
    /// Preliminary availability independent of user parameter values. Concrete
    /// commands always pass through `decode_command` and `authorize` as well.
    fn command_available(&self, _observation: &Observation<Self::Facts>, _id: &str) -> Result<()> {
        Ok(())
    }
    fn authorize_recipe(&self, _observation: &Observation<Self::Facts>, _id: &str) -> Result<()> {
        Ok(())
    }
}
