// Browser Driver adaptation of the Roots driver: generalized model, execution and viewer interfaces; later lifecycle and reporting changes. See THIRD_PARTY_NOTICES.md and licenses/Apache-2.0.txt at the package root.
use crate::*;
use serde_json::{json, Map};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::{self, BufRead, Read, Write};

const MAX_LINE_BYTES: usize = 1024 * 1024;

/// A stateless evaluator: every operation supplies observations and context.
/// The Node runtime, rather than this value, owns active runs and browser handles.
pub struct Engine<M: ApplicationModel> {
    model: M,
    descriptor: ModelDescriptor,
    descriptor_error: Option<DriverError>,
}

impl<M: ApplicationModel> Engine<M> {
    pub fn new(model: M) -> Self {
        let descriptor = model.descriptor();
        let descriptor_error = validate_descriptor(&descriptor).err();
        Self {
            model,
            descriptor,
            descriptor_error,
        }
    }

    pub fn dispatch(&self, request: Value) -> Value {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        match self.dispatch_inner(&request) {
            Ok(fields) => {
                let mut response = fields.as_object().cloned().unwrap_or_default();
                response.insert("protocol".into(), json!(PROTOCOL_VERSION));
                response.insert("id".into(), id);
                response.insert("ok".into(), json!(true));
                Value::Object(response)
            }
            Err(error) => error_response(id, error),
        }
    }

    fn dispatch_inner(&self, request: &Value) -> Result<Value> {
        let object = request
            .as_object()
            .ok_or_else(|| err("invalid_request", "Request must be a JSON object"))?;
        if request.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
            return Err(err("protocol_mismatch", "Expected protocol version 1"));
        }
        if !matches!(
            request.get("id"),
            Some(Value::String(_)) | Some(Value::Number(_))
        ) {
            return Err(err(
                "invalid_request",
                "A string or number correlation id is required",
            ));
        }
        if let Some(error) = &self.descriptor_error {
            return Err(error.clone());
        }
        if let Some(model) = request.get("model") {
            if model.get("id").and_then(Value::as_str) != Some(&self.descriptor.id)
                || model.get("version").and_then(Value::as_str) != Some(&self.descriptor.version)
                || model.as_object().is_none_or(|fields| fields.len() != 2)
            {
                return Err(err(
                    "model_mismatch",
                    "Requested model identity does not match this engine",
                ));
            }
        }
        let op = required_str(request, "op")?;
        let allowed: &[&str] = match op {
            "hello" => &[],
            "observe" => &["observation"],
            "command" => &[
                "observation",
                "fingerprint",
                "command",
                "params",
                "recipeContext",
            ],
            "recipe" => &["observation", "fingerprint", "recipe"],
            "verify" => &[
                "before",
                "observation",
                "command",
                "params",
                "evidence",
                "recipeContext",
            ],
            _ => return Err(err("unknown_operation", "Unknown protocol operation")),
        };
        if object.keys().any(|key| {
            !["protocol", "id", "op", "model"].contains(&key.as_str())
                && !allowed.contains(&key.as_str())
        }) {
            return Err(err(
                "invalid_request",
                "Unexpected field in protocol request",
            ));
        }
        match op {
            "hello" => {
                Ok(json!({"descriptor": self.descriptor,"capabilities":{"recipeContext":1}}))
            }
            "observe" => {
                let observation = self.observation(request, "observation")?;
                let state = self.state(&observation)?;
                let commands: Vec<_> = self
                    .descriptor
                    .commands
                    .iter()
                    .filter(|command| !command.recipe_only)
                    .map(|command| {
                        availability(
                            &command.id,
                            connected(&observation).and_then(|()| {
                                self.model.command_available(&observation, &command.id)
                            }),
                        )
                    })
                    .collect();
                let recipes: Vec<_> = self
                    .descriptor
                    .recipes
                    .iter()
                    .map(|recipe| {
                        availability(
                            &recipe.id,
                            connected(&observation).and_then(|()| {
                                self.model.authorize_recipe(&observation, &recipe.id)
                            }),
                        )
                    })
                    .collect();
                Ok(
                    json!({"state":{"id":state},"fingerprint":self.fingerprint(&observation)?,"commands":commands,"recipes":recipes,"display":self.model.display(&observation)}),
                )
            }
            "command" => {
                let observation = self.observation(request, "observation")?;
                self.state(&observation)?;
                connected(&observation)?;
                self.check_fingerprint(request, &observation)?;
                let id = required_str(request, "command")?;
                let (command, params) = self.command(id, required(request, "params")?)?;
                let context = self.recipe_context(request, &observation, id, &params)?;
                if !self.command_descriptor(id)?.recipe_only {
                    self.model.command_available(&observation, id)?;
                }
                self.model
                    .authorize_scoped(&observation, &command, context.as_ref())?;
                Ok(json!({"action":{"id":id,"params":params}}))
            }
            "recipe" => {
                let observation = self.observation(request, "observation")?;
                self.state(&observation)?;
                connected(&observation)?;
                self.check_fingerprint(request, &observation)?;
                let id = required_str(request, "recipe")?;
                let recipe = self
                    .descriptor
                    .recipes
                    .iter()
                    .find(|recipe| recipe.id == id)
                    .ok_or_else(|| err("unknown_recipe", "Recipe is not declared by this model"))?;
                self.model.authorize_recipe(&observation, id)?;
                let mut plan = Vec::new();
                for step in &recipe.steps {
                    let (_, params) = self.command(&step.command, &step.params)?;
                    plan.push(json!({"command":step.command,"params":params}));
                }
                Ok(json!({"plan":plan}))
            }
            "verify" => {
                let before = self.observation(request, "before")?;
                let after = self.observation(request, "observation")?;
                self.state(&before)?;
                self.state(&after)?;
                connected(&before)?;
                connected(&after)?;
                let id = required_str(request, "command")?;
                let descriptor = self.command_descriptor(id)?;
                if before.session != after.session && !descriptor.changes_session {
                    return Err(err(
                        "session_changed",
                        "Session changed while executing the command",
                    ));
                }
                let (command, params) = self.command(id, required(request, "params")?)?;
                let context = self.recipe_context(request, &before, id, &params)?;
                if context
                    .as_ref()
                    .is_some_and(|context| context.session != after.session)
                {
                    return Err(err(
                        "recipe_session_changed",
                        "Recipe cannot verify in another session",
                    ));
                }
                self.model
                    .authorize_scoped(&before, &command, context.as_ref())?;
                let evidence = required(request, "evidence")?;
                if !evidence.is_object() {
                    return Err(err("invalid_evidence", "Evidence must be an object"));
                }
                let outcome = self.model.verify_scoped(
                    &before,
                    &after,
                    &command,
                    evidence,
                    context.as_ref(),
                )?;
                Ok(json!({"outcome":self.model.outcome_report(&outcome)}))
            }
            _ => unreachable!(),
        }
    }

    fn observation(&self, request: &Value, field: &str) -> Result<Observation<M::Facts>> {
        // Do not echo serde's input-bearing diagnostic: it may contain user data.
        serde_json::from_value(required(request, field)?.clone()).map_err(|_| {
            err(
                "invalid_observation",
                "Observation does not match the model schema",
            )
        })
    }

    fn state(&self, observation: &Observation<M::Facts>) -> Result<String> {
        let id = self.model.state_id(&self.model.state(observation)?);
        let state = self
            .descriptor
            .states
            .iter()
            .find(|state| state.id == id)
            .ok_or_else(|| {
                err(
                    "unknown_state",
                    "Observed state is not declared by this model",
                )
            })?;
        if state.support != Support::Supported {
            return Err(err(
                "unsupported_state",
                "Observed state is planned, not supported",
            ));
        }
        if self
            .descriptor
            .states
            .iter()
            .any(|child| child.parent.as_deref() == Some(&id))
        {
            return Err(err(
                "unknown_state",
                "Observation must resolve to a specific leaf state",
            ));
        }
        Ok(id)
    }

    fn fingerprint(&self, observation: &Observation<M::Facts>) -> Result<String> {
        let value = json!({"protocol":PROTOCOL_VERSION,"model":{"id":self.descriptor.id,"version":self.descriptor.version},"observation":observation});
        // Value maps are ordered without serde_json's preserve_order feature;
        // canonicalize recursively so downstream feature unification is safe.
        let serialized = serde_json::to_vec(&canonical(value))
            .map_err(|_| err("invalid_observation", "Observation cannot be fingerprinted"))?;
        Ok(format!("{:x}", Sha256::digest(serialized)))
    }

    fn check_fingerprint(
        &self,
        request: &Value,
        observation: &Observation<M::Facts>,
    ) -> Result<()> {
        if request.get("fingerprint").and_then(Value::as_str)
            != Some(&self.fingerprint(observation)?)
        {
            return Err(err(
                "stale_observation",
                "Observation or session changed; observe again before executing",
            ));
        }
        Ok(())
    }

    fn command_descriptor(&self, id: &str) -> Result<&CommandDescriptor> {
        self.descriptor
            .commands
            .iter()
            .find(|command| command.id == id)
            .ok_or_else(|| err("unknown_command", "Command is not declared by this model"))
    }

    fn recipe_context(
        &self,
        request: &Value,
        observation: &Observation<M::Facts>,
        id: &str,
        params: &Value,
    ) -> Result<Option<RecipeContext>> {
        let descriptor = self.command_descriptor(id)?;
        let Some(value) = request.get("recipeContext") else {
            return if descriptor.recipe_only {
                Err(err(
                    "recipe_scope_required",
                    "This command requires a canonical recipe step",
                ))
            } else {
                Ok(None)
            };
        };
        let context: RecipeContext = serde_json::from_value(value.clone()).map_err(|_| {
            err(
                "invalid_recipe_context",
                "Recipe context must identify a recipe, step and session",
            )
        })?;
        if context.session != observation.session {
            return Err(err(
                "recipe_session_changed",
                "Recipe cannot continue in another session",
            ));
        }
        let mismatch = || {
            err(
                "recipe_step_mismatch",
                "Command and parameters must match the canonical recipe step",
            )
        };
        let step = self
            .descriptor
            .recipes
            .iter()
            .find(|recipe| recipe.id == context.recipe)
            .and_then(|recipe| recipe.steps.get(context.step))
            .ok_or_else(mismatch)?;
        if step.command != id || parameters(descriptor, &step.params)? != *params {
            return Err(mismatch());
        }
        Ok(Some(context))
    }

    fn command(&self, id: &str, input: &Value) -> Result<(M::Command, Value)> {
        let descriptor = self.command_descriptor(id)?;
        let params = parameters(descriptor, input)?;
        Ok((self.model.decode_command(id, &params)?, params))
    }
}

fn err(code: &str, message: &str) -> DriverError {
    DriverError::new(code, message)
}

fn required<'a>(request: &'a Value, field: &str) -> Result<&'a Value> {
    request
        .get(field)
        .ok_or_else(|| err("invalid_request", "A required protocol field is missing"))
}

fn required_str<'a>(request: &'a Value, field: &str) -> Result<&'a str> {
    required(request, field)?
        .as_str()
        .ok_or_else(|| err("invalid_request", "Expected a string protocol field"))
}

fn connected<F>(observation: &Observation<F>) -> Result<()> {
    if !observation.connected {
        return Err(err(
            "disconnected",
            "Controlled application is disconnected",
        ));
    }
    if observation.session.is_empty() {
        return Err(err("invalid_observation", "Session identity is required"));
    }
    Ok(())
}

fn availability(id: &str, result: Result<()>) -> Value {
    match result {
        Ok(()) => json!({"id":id,"enabled":true}),
        Err(error) => json!({"id":id,"enabled":false,"reason":error.message}),
    }
}

fn parameters(descriptor: &CommandDescriptor, input: &Value) -> Result<Value> {
    let mut params = input
        .as_object()
        .cloned()
        .ok_or_else(|| err("invalid_params", "Command parameters must be an object"))?;
    if params
        .keys()
        .any(|key| !descriptor.params.contains_key(key))
    {
        return Err(err(
            "invalid_params",
            "Command contains undeclared parameters",
        ));
    }
    for (name, parameter) in &descriptor.params {
        if !params.contains_key(name) {
            if let Some(default) = &parameter.default {
                params.insert(name.clone(), default.clone());
            }
        }
        match params.get(name) {
            Some(value) if !parameter_matches(parameter, value) => {
                return Err(err(
                    "invalid_params",
                    "Parameter value does not match its descriptor",
                ));
            }
            None if parameter.required => {
                return Err(err(
                    "invalid_params",
                    "A required command parameter is missing",
                ));
            }
            _ => {}
        }
    }
    Ok(Value::Object(params))
}

fn parameter_matches(parameter: &Parameter, value: &Value) -> bool {
    match parameter.kind {
        ParameterType::Text | ParameterType::Password => value.as_str().is_some_and(|text| {
            parameter
                .max_length
                .is_none_or(|limit| text.chars().count() <= limit)
        }),
        ParameterType::Number => value.as_f64().is_some_and(|number| {
            number.is_finite()
                && parameter.minimum.is_none_or(|minimum| number >= minimum)
                && parameter.maximum.is_none_or(|maximum| number <= maximum)
        }),
        ParameterType::Boolean => value.is_boolean(),
        ParameterType::Select => value
            .as_str()
            .is_some_and(|value| parameter.options.iter().any(|option| option.value == value)),
    }
}

// Paths use declaration indexes instead of caller-authored names. Parameters
// are BTreeMap entries, indexed in Rust's lexicographic key order. Every rule is
// static text; malformed descriptors must never leak labels, keys or values.
fn invalid_model(path: &str, rule: &str) -> DriverError {
    let parameter_order = if path.contains(".params[") {
        " Parameter indexes are zero-based in sorted name order."
    } else {
        ""
    };
    err(
        "invalid_model",
        &format!("Invalid model at {path}: {rule}.{parameter_order}"),
    )
}

fn validate_descriptor(descriptor: &ModelDescriptor) -> Result<()> {
    for (field, value) in [
        ("id", &descriptor.id),
        ("version", &descriptor.version),
        ("label", &descriptor.label),
    ] {
        if value.is_empty() {
            return Err(invalid_model(
                &format!("descriptor.{field}"),
                "must not be empty",
            ));
        }
    }
    if descriptor.states.is_empty() {
        return Err(invalid_model(
            "descriptor.states",
            "must contain at least one state",
        ));
    }
    let mut states = BTreeMap::new();
    for (index, state) in descriptor.states.iter().enumerate() {
        let path = format!("descriptor.states[{index}]");
        if state.id.is_empty() {
            return Err(invalid_model(&format!("{path}.id"), "must not be empty"));
        }
        if state.label.is_empty() {
            return Err(invalid_model(&format!("{path}.label"), "must not be empty"));
        }
        if states.insert(&state.id, (index, state)).is_some() {
            return Err(invalid_model(
                &format!("{path}.id"),
                "must be unique among states",
            ));
        }
    }
    for (index, state) in descriptor.states.iter().enumerate() {
        let mut seen = BTreeSet::new();
        let mut cursor = (index, state);
        while let Some(parent) = &cursor.1.parent {
            let path = format!("descriptor.states[{}].parent", cursor.0);
            if !seen.insert(&cursor.1.id) {
                return Err(invalid_model(&path, "state parents must not form a cycle"));
            }
            cursor = *states
                .get(parent)
                .ok_or_else(|| invalid_model(&path, "must reference a declared state"))?;
        }
    }
    let mut commands = BTreeMap::new();
    for (index, command) in descriptor.commands.iter().enumerate() {
        let path = format!("descriptor.commands[{index}]");
        if command.id.is_empty() {
            return Err(invalid_model(&format!("{path}.id"), "must not be empty"));
        }
        if command.label.is_empty() {
            return Err(invalid_model(&format!("{path}.label"), "must not be empty"));
        }
        if commands.insert(&command.id, command).is_some() {
            return Err(invalid_model(
                &format!("{path}.id"),
                "must be unique among commands",
            ));
        }
        for (parameter_index, (name, parameter)) in command.params.iter().enumerate() {
            let path = format!("{path}.params[{parameter_index}]");
            if name.is_empty() {
                return Err(invalid_model(&format!("{path}.name"), "must not be empty"));
            }
            if parameter.label.is_empty() {
                return Err(invalid_model(&format!("{path}.label"), "must not be empty"));
            }
            for (field, value) in [
                ("minimum", parameter.minimum),
                ("maximum", parameter.maximum),
            ] {
                if let Some(value) = value {
                    if !value.is_finite() {
                        return Err(invalid_model(&format!("{path}.{field}"), "must be finite"));
                    }
                    if parameter.kind != ParameterType::Number {
                        return Err(invalid_model(
                            &format!("{path}.{field}"),
                            "only permitted for number parameters",
                        ));
                    }
                }
            }
            if matches!((parameter.minimum,parameter.maximum), (Some(a),Some(b)) if a>b) {
                return Err(invalid_model(
                    &format!("{path}.minimum"),
                    "must not exceed maximum",
                ));
            }
            if parameter.kind == ParameterType::Select && parameter.options.is_empty() {
                return Err(invalid_model(
                    &format!("{path}.options"),
                    "select parameters must contain at least one option",
                ));
            }
            if parameter.kind != ParameterType::Select && !parameter.options.is_empty() {
                return Err(invalid_model(
                    &format!("{path}.options"),
                    "only permitted for select parameters",
                ));
            }
            if !matches!(
                parameter.kind,
                ParameterType::Text | ParameterType::Password
            ) && parameter.max_length.is_some()
            {
                return Err(invalid_model(
                    &format!("{path}.maxLength"),
                    "maxLength (Rust max_length) is only permitted for text parameters or password parameters",
                ));
            }
            if parameter
                .default
                .as_ref()
                .is_some_and(|value| !parameter_matches(parameter, value))
            {
                return Err(invalid_model(
                    &format!("{path}.default"),
                    "must match the parameter type and constraints",
                ));
            }
            let mut options = BTreeSet::new();
            for (option_index, option) in parameter.options.iter().enumerate() {
                let path = format!("{path}.options[{option_index}]");
                if option.label.is_empty() {
                    return Err(invalid_model(&format!("{path}.label"), "must not be empty"));
                }
                if !options.insert(&option.value) {
                    return Err(invalid_model(
                        &format!("{path}.value"),
                        "must be unique among options",
                    ));
                }
            }
        }
    }
    let mut recipes = BTreeSet::new();
    for (index, recipe) in descriptor.recipes.iter().enumerate() {
        let path = format!("descriptor.recipes[{index}]");
        if recipe.id.is_empty() {
            return Err(invalid_model(&format!("{path}.id"), "must not be empty"));
        }
        if recipe.label.is_empty() {
            return Err(invalid_model(&format!("{path}.label"), "must not be empty"));
        }
        if recipe.steps.is_empty() {
            return Err(invalid_model(
                &format!("{path}.steps"),
                "must contain at least one step",
            ));
        }
        if !recipes.insert(&recipe.id) {
            return Err(invalid_model(
                &format!("{path}.id"),
                "must be unique among recipes",
            ));
        }
        for (step_index, step) in recipe.steps.iter().enumerate() {
            let path = format!("{path}.steps[{step_index}]");
            let command = commands.get(&step.command).ok_or_else(|| {
                invalid_model(
                    &format!("{path}.command"),
                    "must reference a declared command",
                )
            })?;
            // `parameters` is the same strict normalizer used by execution. Its
            // messages are fixed rules and never contain supplied keys/values.
            parameters(command, &step.params)
                .map_err(|error| invalid_model(&format!("{path}.params"), &error.message))?;
        }
    }
    Ok(())
}

fn canonical(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.into_iter().collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect::<Map<_, _>>(),
            )
        }
        Value::Array(array) => Value::Array(array.into_iter().map(canonical).collect()),
        scalar => scalar,
    }
}

fn error_response(id: Value, error: DriverError) -> Value {
    json!({"protocol":PROTOCOL_VERSION,"id":id,"ok":false,"error_code":error.code,"error":error.message})
}

/// Run a native JSON Lines engine. Stdout contains one flushed protocol reply
/// per input line; application logging belongs on stderr. No automatic retries.
pub fn serve<M: ApplicationModel>(model: M) -> io::Result<()> {
    let engine = Engine::new(model);
    let input = io::stdin();
    let mut reader = input.lock();
    let output = io::stdout();
    let mut writer = output.lock();
    loop {
        let mut line = Vec::new();
        let length = reader
            .by_ref()
            .take((MAX_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?;
        if length == 0 {
            break;
        }
        let response = if length > MAX_LINE_BYTES {
            if line.last() != Some(&b'\n') {
                loop {
                    let buffer = reader.fill_buf()?;
                    if buffer.is_empty() {
                        break;
                    }
                    let newline = buffer.iter().position(|byte| *byte == b'\n');
                    let consumed = newline.map_or(buffer.len(), |index| index + 1);
                    reader.consume(consumed);
                    if newline.is_some() {
                        break;
                    }
                }
            }
            error_response(
                Value::Null,
                err("invalid_request", "Protocol line exceeds the size limit"),
            )
        } else {
            match serde_json::from_slice(&line) {
                Ok(request) => engine.dispatch(request),
                Err(_) => error_response(
                    Value::Null,
                    err("invalid_json", "Protocol input is not valid JSON"),
                ),
            }
        };
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}
