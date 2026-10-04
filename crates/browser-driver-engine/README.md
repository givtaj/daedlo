# browser-driver-engine

Native Rust decision engine for browser-driver. A customer implements
`ApplicationModel` with typed facts, states, commands and outcomes, then calls
`browser_driver_engine::serve(model)` in its executable. Node communicates with
that executable through JSON Lines on stdin/stdout. This crate does not launch
a browser, run application effects or assign application state after clicks.

`Engine::new(model).dispatch(request)` provides the same evaluator in process
for deterministic contract tests. The engine validates descriptors, protocol
version, typed observations, command parameters, supported leaf states,
full-observation fingerprints and session changes. Model errors fail closed.

Models provide explicit stable descriptor IDs, never Rust debug strings. Mark
facts structs with `#[serde(deny_unknown_fields)]`, make required observations
non-optional and keep observed state separate from temporal evidence. A save
that produces validation or a recoverable error is distinct from persistence
success. The model decides the evidence necessary for each outcome.

`command_available` supplies parameter-independent availability for the viewer;
`authorize` checks the actual decoded command immediately before execution.
`authorize_recipe` checks initial recipe prerequisites. The runtime subsequently
authorizes each step with fresh observations. Authored recipes are not automatic
planning or learning.

Models and Node adapters are trusted integration code. Keep credentials and raw
private data out of public display facts, errors and labels. The fingerprint is
a change detector, not an authorization token or anonymization mechanism. The
Node runtime must also check model compatibility and handler coverage before
actions, exclude concurrent runs and reobserve at action boundaries.

See `examples/notebook-engine` in the repository for a complete model and its
protocol and executable-process tests.
