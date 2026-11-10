# Reviewed model changes

Use the explicit model-migration workflow when a reviewed integration change
alters its complete Rust descriptor. Ordinary `refresh` still refuses these
changes. A migration builds a new installation from the **accepted exact runtime
release**, using the existing registration and store. It runs the same model
handshake, acceptance and health checks before making the candidate reviewable.
Preparing or reviewing a migration does not select or run the candidate.

This workflow belongs to tools containing `migrate-prepare`, `migrate-review` and
`migrate-activate`. Earlier tools without these commands cannot perform this
workflow. Source verification, a packaged tools release and customer acceptance are
separate milestones; consult the [source verification record](https://github.com/givtaj/daedlo/blob/main/docs/verification.md)
for measured status.

## Prepare and review

Preserve the accepted tools, browser cache, original source and evidence. Review
the intended model/adapter changes and update the integration's acceptance checks
for the new behavior. Keep the separate QA integration's dependencies and the
application's everyday dependencies distinct.

If the registration's `model.id`, `model.version` or optional `descriptorSha256`
pin must change, **safely stop the old owner before editing that registration**.
Use the original configuration for that stop. The native owner's configuration
identity guard remains in force; a changed configuration cannot silently take
over a running owner. After stopping, retain the same project ID, source root,
configuration path and store. The old installation remains selected until an
explicit successful activation.

Model migration permits changes to the registration's `model` and
`descriptorSha256` fields only. The source allowlist, launcher, hooks, dependency
paths, interfaces and every other registration field must remain unchanged.
Authored model/adapter/acceptance source may change within that existing allowlist.
The compiled model must match the new registered identity and optional descriptor
pin; protocol, capability and dependency validation remain mandatory. Broader
integration or dependency migrations need their own review.

Run the following using the selected tools' `daedlo-native` command and your
existing configuration. Replace placeholders with returned values:

```sh
daedlo-native migrate-prepare --config /absolute/path/to/daedlo.json
daedlo-native migrate-review --config /absolute/path/to/daedlo.json --operation OPERATION_ID
```

Preparation copies and verifies the accepted retained bundle without contacting
the release feed. A missing or tampered bundle blocks preparation. It preserves
the old installation, source snapshot, reports and history. The new candidate is
`review_required`; ordinary Restart or activation cannot select it.

Review prints both complete descriptors, model identities, descriptor pins,
installation/source identities, release identity, store generation and
`reviewSha256`. Check every intended state, command, parameter, recipe and label
change, together with the acceptance result. This is local integration metadata;
keep the review file private when customer-authored declarations contain private
names. The manager's ordinary status response does not expose the descriptors.
A digest binds reviewed content; it does not anonymize that content or prove that
a person reviewed it.

## Activate and retain recovery

After reviewing that exact candidate, explicitly supply its operation and review
SHA256:

```sh
daedlo-native migrate-activate --config /absolute/path/to/daedlo.json --operation OPERATION_ID --review-sha256 REVIEW_SHA256
```

Activation rechecks the current selection and generation, retained review,
accepted/candidate receipts and authored source. Missing, mismatched, stale or
altered review data refuses activation. Another successful switch, candidate
replacement or changed source requires a new preparation and review.

The normal shutdown guards still apply: current observation, idle execution,
known clean drafts, complete evidence and owned-resource cleanup. Model migration
does not bypass a failed observation, abandon a run, hot-replace an adapter or
replay an application action. Resolve any retained old owner before continuing.

The candidate is reverified after the old owner drains. If source changes at that
boundary, activation refuses and keeps the old selection; the old owner may
already be stopped. Resolve the source change and prepare again rather than
claiming that the candidate started.

A successful switch retains the previous complete installation and records the
review identity in transaction history. Candidate boot failure restores the old
selection through ordinary recovery. A crash retains the transaction and its
review identity for recovery. Revert selects the old sealed model, adapter and
runtime without overwriting current authored files or undoing application writes.
Retain both tools/browser installations required by those slots.

The private store retains the full review under
`migrations/OPERATION_ID.json`; committed and recovered history references its
operation and review SHA256. Keep these alongside installation receipts and
application evidence. A successful migration is installation acceptance, not a
claim that every customer business flow has passed.
