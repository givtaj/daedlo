// Negative handshake fixture only. Never select this executable for a real run.
fn main() -> std::io::Result<()> {
    daedlo_engine::serve(daedlo_starter_engine::StarterModel {
        invalid_select_constraint: true,
    })
}
