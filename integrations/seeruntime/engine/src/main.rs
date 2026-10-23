use daedlo_engine::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Facts {
    model: String,
    scenario: String,
    play_label: String,
    ready: bool,
    complete: bool,
    controls: bool,
    scene: bool,
    phase_present: bool,
    looping: bool,
    speed: String,
    event_total: u32,
}
#[derive(Debug, PartialEq, Eq)]
enum Playback {
    Idle,
    Playing,
    Paused,
    Complete,
}
#[derive(Debug, PartialEq, Eq)]
enum State {
    Lesson(Playback),
    Unavailable,
}
#[derive(Debug)]
enum Command {
    SelectIo,
    Step,
    Play,
    Pause,
    Reset,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Metrics {
    phase: String,
    event: u32,
    timeline: f64,
    active: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Evidence {
    before: Metrics,
    after: Metrics,
    later: Metrics,
}
struct Model;
fn denied() -> DriverError {
    DriverError::new(
        "command_disabled",
        "Select the available Node I/O lesson with normal speed and loop off",
    )
}

impl ApplicationModel for Model {
    type Facts = Facts;
    type State = State;
    type Command = Command;
    type Outcome = OutcomeReport;
    fn descriptor(&self) -> ModelDescriptor {
        let states = [
            ("lesson", "Node lesson", None),
            ("lesson.idle", "Ready", Some("lesson")),
            ("lesson.playing", "Playing", Some("lesson")),
            ("lesson.paused", "Paused", Some("lesson")),
            ("lesson.complete", "Complete", Some("lesson")),
            ("unavailable", "Unavailable", None),
        ];
        let commands = [
            ("select_io", "Open Node I/O lesson"),
            ("step", "Step one event"),
            ("play", "Play simulation"),
            ("pause", "Pause simulation"),
            ("reset", "Reset lesson"),
        ];
        serde_json::from_value(json!({
            "id":"seeruntime-playback", "version":"068d573-v1", "label":"SeeRuntime playback",
            "states": states.into_iter().map(|(id,label,parent)| json!({"id":id,"label":label,"parent":parent,"support":"supported"})).collect::<Vec<_>>(),
            "commands": commands.into_iter().map(|(id,label)| json!({"id":id,"label":label,"params":{}})).collect::<Vec<_>>(),
            "recipes":[{"id":"io_walkthrough","label":"Node I/O walkthrough","steps":(["select_io","step","play","pause","step","reset"].into_iter().map(|command| json!({"command":command,"params":{}})).collect::<Vec<_>>())}]
        })).expect("static descriptor")
    }
    fn state(&self, o: &Observation<Facts>) -> Result<State> {
        let f = &o.facts;
        if !o.connected
            || !f.controls
            || !f.scene
            || !f.phase_present
            || f.model != "node"
            || !["io", "checkpoints", "starvation"].contains(&f.scenario.as_str())
            || f.event_total == 0
            || (f.ready && f.complete)
        {
            return Ok(State::Unavailable);
        }
        let state = match (f.play_label.as_str(), f.ready, f.complete) {
            ("Play simulation", true, false) => State::Lesson(Playback::Idle),
            ("Play simulation", false, false) => State::Lesson(Playback::Paused),
            ("Play simulation", false, true) => State::Lesson(Playback::Complete),
            ("Pause simulation", false, false) => State::Lesson(Playback::Playing),
            _ => State::Unavailable,
        };
        Ok(state)
    }
    fn state_id(&self, state: &State) -> String {
        match state {
            State::Unavailable => "unavailable",
            State::Lesson(Playback::Idle) => "lesson.idle",
            State::Lesson(Playback::Playing) => "lesson.playing",
            State::Lesson(Playback::Paused) => "lesson.paused",
            State::Lesson(Playback::Complete) => "lesson.complete",
        }
        .into()
    }
    fn decode_command(&self, id: &str, params: &Value) -> Result<Command> {
        if params != &json!({}) {
            return Err(DriverError::new(
                "invalid_params",
                "Playback commands take no parameters",
            ));
        }
        match id {
            "select_io" => Ok(Command::SelectIo),
            "step" => Ok(Command::Step),
            "play" => Ok(Command::Play),
            "pause" => Ok(Command::Pause),
            "reset" => Ok(Command::Reset),
            _ => Err(DriverError::new(
                "unknown_command",
                "Unknown playback command",
            )),
        }
    }
    fn authorize(&self, o: &Observation<Facts>, command: &Command) -> Result<()> {
        let state = self.state(o)?;
        if state == State::Unavailable {
            return Err(denied());
        }
        if matches!(command, Command::SelectIo) {
            return Ok(());
        }
        if o.facts.scenario != "io"
            || o.facts.looping
            || o.facts.speed != "1"
            || o.facts.event_total != 11
        {
            return Err(denied());
        }
        match (command, state) {
            (Command::Step, State::Lesson(Playback::Idle | Playback::Paused))
            | (
                Command::Play,
                State::Lesson(Playback::Idle | Playback::Paused | Playback::Complete),
            )
            | (Command::Pause, State::Lesson(Playback::Playing))
            | (Command::Reset, State::Lesson(_)) => Ok(()),
            _ => Err(denied()),
        }
    }
    fn verify(
        &self,
        _before: &Observation<Facts>,
        after: &Observation<Facts>,
        command: &Command,
        evidence: &Value,
    ) -> Result<OutcomeReport> {
        let e: Evidence = serde_json::from_value(evidence.clone()).map_err(|_| {
            DriverError::new(
                "invalid_evidence",
                "Playback outcome requires measured before, after and later DOM evidence",
            )
        })?;
        let state = self.state(after)?;
        let success = after.facts.model == "node"
            && after.facts.scenario == "io"
            && match command {
                Command::SelectIo => {
                    state == State::Lesson(Playback::Idle)
                        && after.facts.event_total == 11
                        && e.after.event == 0
                        && e.after.timeline == 0.0
                        && e.after.active == 0
                }
                Command::Step => {
                    state == State::Lesson(Playback::Paused)
                        && e.after.event == e.before.event + 1
                        && e.after.active == 1
                        && e.after.event == e.later.event
                        && e.after.timeline == e.later.timeline
                }
                Command::Play => {
                    state == State::Lesson(Playback::Playing) && e.later.timeline > e.after.timeline
                }
                Command::Pause => {
                    state == State::Lesson(Playback::Paused)
                        && e.after.event == e.later.event
                        && e.after.timeline == e.later.timeline
                }
                Command::Reset => {
                    state == State::Lesson(Playback::Idle)
                        && e.after.phase == "Ready"
                        && e.after.event == 0
                        && e.after.timeline == 0.0
                        && e.after.active == 0
                }
            };
        Ok(OutcomeReport {
            kind: if success {
                OutcomeKind::Success
            } else {
                OutcomeKind::Unknown
            },
            label: if success {
                "Expected playback change confirmed by DOM and temporal evidence"
            } else {
                "Expected playback change was not confirmed"
            }
            .into(),
        })
    }
    fn outcome_report(&self, outcome: &OutcomeReport) -> OutcomeReport {
        outcome.clone()
    }
    fn command_available(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        self.authorize(o, &self.decode_command(id, &json!({}))?)
    }
    fn authorize_recipe(&self, o: &Observation<Facts>, id: &str) -> Result<()> {
        if id != "io_walkthrough" {
            return Err(DriverError::new(
                "unknown_recipe",
                "Unknown playback recipe",
            ));
        }
        if self.state(o)? != State::Lesson(Playback::Idle)
            || o.facts.looping
            || o.facts.speed != "1"
        {
            return Err(denied());
        }
        Ok(())
    }
    fn display(&self, o: &Observation<Facts>) -> Vec<DisplayFact> {
        vec![
            DisplayFact {
                label: "Model".into(),
                value: json!(o.facts.model),
            },
            DisplayFact {
                label: "Scenario".into(),
                value: json!(o.facts.scenario),
            },
            DisplayFact {
                label: "Persistence".into(),
                value: json!("No persistent writes in this flow"),
            },
        ]
    }
}

fn main() -> std::io::Result<()> {
    daedlo_engine::serve(Model)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn observed() -> Observation<Facts> {
        serde_json::from_value(json!({"connected":true,"session":"owned-fixture","facts":{"model":"node","scenario":"io","play_label":"Play simulation","ready":true,"complete":false,"controls":true,"scene":true,"phase_present":true,"looping":false,"speed":"1","event_total":11}})).unwrap()
    }
    #[test]
    fn observes_ready_lesson_and_enabled_step() {
        let o = observed();
        assert_eq!(Model.state(&o).unwrap(), State::Lesson(Playback::Idle));
        assert!(Model.authorize(&o, &Command::Step).is_ok());
        assert!(Model.authorize(&o, &Command::Pause).is_err());
    }
    #[test]
    fn missing_or_inconsistent_readiness_denies_actions() {
        for field in ["scene", "controls", "connected"] {
            let mut o = observed();
            match field {
                "scene" => o.facts.scene = false,
                "controls" => o.facts.controls = false,
                _ => o.connected = false,
            };
            assert_eq!(Model.state(&o).unwrap(), State::Unavailable);
            assert!(Model.authorize(&o, &Command::SelectIo).is_err());
        }
        let mut o = observed();
        o.facts.play_label = "Pause simulation".into();
        assert_eq!(Model.state(&o).unwrap(), State::Unavailable);
    }
    #[test]
    fn playing_allows_pause_and_denies_step_or_play() {
        let mut o = observed();
        o.facts.ready = false;
        o.facts.play_label = "Pause simulation".into();
        assert_eq!(Model.state(&o).unwrap(), State::Lesson(Playback::Playing));
        assert!(Model.authorize(&o, &Command::Pause).is_ok());
        assert!(Model.authorize(&o, &Command::Step).is_err());
        assert!(Model.authorize(&o, &Command::Play).is_err());
    }
    #[test]
    fn context_and_recipe_guards_are_explicit() {
        let mut o = observed();
        o.facts.scenario = "checkpoints".into();
        assert!(Model.authorize(&o, &Command::Step).is_err());
        assert!(Model.authorize(&o, &Command::SelectIo).is_ok());
        o.facts.looping = true;
        assert!(Model.authorize_recipe(&o, "io_walkthrough").is_err());
    }
    #[test]
    fn unknown_labels_fields_params_and_absent_evidence_fail_closed() {
        let mut o = observed();
        o.facts.play_label = "Loading".into();
        assert_eq!(Model.state(&o).unwrap(), State::Unavailable);
        assert!(Model.decode_command("step", &json!({"count":5})).is_err());
        assert!(Model
            .verify(&observed(), &observed(), &Command::Reset, &json!({}))
            .is_err());
        let mut facts = serde_json::to_value(observed().facts).unwrap();
        facts.as_object_mut().unwrap().remove("scene");
        assert!(serde_json::from_value::<Facts>(facts).is_err());
    }
    #[test]
    fn stopped_timeline_cannot_claim_play_success() {
        let before = observed();
        let mut after = observed();
        after.facts.ready = false;
        after.facts.play_label = "Pause simulation".into();
        let evidence = json!({"before":{"phase":"Ready","event":0,"timeline":0,"active":0},"after":{"phase":"File request","event":1,"timeline":1,"active":1},"later":{"phase":"File request","event":1,"timeline":1,"active":1}});
        assert_eq!(
            Model
                .verify(&before, &after, &Command::Play, &evidence)
                .unwrap()
                .kind,
            OutcomeKind::Unknown
        );
    }
}
