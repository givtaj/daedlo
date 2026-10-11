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
            "command" => &["observation", "fingerprint", "command", "params"],
            "recipe" => &["observation", "fingerprint", "recipe"],
            "verify" => &["before", "observation", "command", "params", "evidence"],
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
            "hello" => Ok(json!({"descriptor": self.descriptor})),
            "observe" => {
                let observation = self.observation(request, "observation")?;
                let state = self.state(&observation)?;
                let commands: Vec<_> = self
                    .descriptor
                    .commands
                    .iter()
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
                self.model.command_available(&observation, id)?;
                self.model.authorize(&observation, &command)?;
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
                let (command, _) = self.command(id, required(request, "params")?)?;
                self.model.authorize(&before, &command)?;
                let evidence = required(request, "evidence")?;
                if !evidence.is_object() {
                    return Err(err("invalid_evidence", "Evidence must be an object"));
                }
                let outcome = self.model.verify(&before, &after, &command, evidence)?;
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
                ))
            }
            None if parameter.required => {
                return Err(err(
                    "invalid_params",
                    "A required command parameter is missing",
                ))
            }
            _ => {}
        }
    }
    Ok(Value::Object(params))
}

fn parameter_matches(parameter: &Parameter, value: &Value) -> bool {
    match parameter.kind {
        ParameterType::Text => value.as_str().is_some_and(|text| {
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

fn validate_descriptor(descriptor: &ModelDescriptor) -> Result<()> {
    let invalid = || {
        err(
            "invalid_model",
            "Model descriptor has invalid or inconsistent declarations",
        )
    };
    if descriptor.id.is_empty()
        || descriptor.version.is_empty()
        || descriptor.label.is_empty()
        || descriptor.states.is_empty()
    {
        return Err(invalid());
    }
    let mut states = BTreeMap::new();
    for state in &descriptor.states {
        if state.id.is_empty()
            || state.label.is_empty()
            || states.insert(&state.id, state).is_some()
        {
            return Err(invalid());
        }
    }
    for state in &descriptor.states {
        let mut seen = BTreeSet::new();
        let mut cursor = state;
        while let Some(parent) = &cursor.parent {
            if !seen.insert(&cursor.id) {
                return Err(invalid());
            }
            cursor = states.get(parent).ok_or_else(invalid)?;
        }
    }
    let mut commands = BTreeMap::new();
    for command in &descriptor.commands {
        if command.id.is_empty()
            || command.label.is_empty()
            || commands.insert(&command.id, command).is_some()
        {
            return Err(invalid());
        }
        for (name, parameter) in &command.params {
            if name.is_empty()
                || parameter.label.is_empty()
                || parameter.minimum.is_some_and(|v| !v.is_finite())
                || parameter.maximum.is_some_and(|v| !v.is_finite())
                || matches!((parameter.minimum,parameter.maximum), (Some(a),Some(b)) if a>b)
                || (parameter.kind == ParameterType::Select && parameter.options.is_empty())
                || (parameter.kind != ParameterType::Select && !parameter.options.is_empty())
                || (parameter.kind != ParameterType::Text && parameter.max_length.is_some())
                || (parameter.kind != ParameterType::Number
                    && (parameter.minimum.is_some() || parameter.maximum.is_some()))
                || parameter
                    .default
                    .as_ref()
                    .is_some_and(|value| !parameter_matches(parameter, value))
            {
                return Err(invalid());
            }
            let mut options = BTreeSet::new();
            for option in &parameter.options {
                if option.label.is_empty() || !options.insert(&option.value) {
                    return Err(invalid());
                }
            }
        }
    }
    let mut recipes = BTreeSet::new();
    for recipe in &descriptor.recipes {
        if recipe.id.is_empty()
            || recipe.label.is_empty()
            || recipe.steps.is_empty()
            || !recipes.insert(&recipe.id)
        {
            return Err(invalid());
        }
        for step in &recipe.steps {
            let command = commands.get(&step.command).ok_or_else(invalid)?;
            parameters(command, &step.params).map_err(|_| invalid())?;
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
