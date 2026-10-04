use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

#[test]
fn native_engine_flushes_correlated_jsonlines_and_continues_after_invalid_json() {
    let mut process = Command::new(env!("CARGO_BIN_EXE_notebook-engine"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut writer = process.stdin.take().unwrap();
    let mut reader = BufReader::new(process.stdout.take().unwrap());
    // Reading before closing stdin proves that every response is flushed.
    writeln!(writer, "{}", json!({"protocol":1,"id":"one","op":"hello"})).unwrap();
    writer.flush().unwrap();
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let first: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(first["id"], "one");
    assert_eq!(first["ok"], true);
    writeln!(writer, "not json").unwrap();
    writeln!(writer, "{}", json!({"protocol":1,"id":2,"op":"hello"})).unwrap();
    writer.flush().unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let invalid: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(invalid["error_code"], "invalid_json");
    assert_eq!(invalid["id"], Value::Null);
    line.clear();
    reader.read_line(&mut line).unwrap();
    let last: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(last["id"], 2);
    assert_eq!(last["ok"], true);
    drop(writer);
    let output = process.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
}

#[test]
fn oversized_line_is_bounded_and_next_request_is_framed_correctly() {
    let mut process = Command::new(env!("CARGO_BIN_EXE_notebook-engine"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut writer = process.stdin.take().unwrap();
    writer.write_all(&vec![b'x'; 1024 * 1024 + 100]).unwrap();
    writer.write_all(b"\n").unwrap();
    writeln!(
        writer,
        "{}",
        json!({"protocol":1,"id":"after-large","op":"hello"})
    )
    .unwrap();
    drop(writer);
    let output = process.wait_with_output().unwrap();
    assert!(output.status.success());
    let replies: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 2);
    assert_eq!(replies[0]["error_code"], "invalid_request");
    assert_eq!(replies[1]["id"], "after-large");
    assert_eq!(replies[1]["ok"], true);
}
