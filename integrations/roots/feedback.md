# First customer feedback: Profile validation correction

Source: isolated Roots `d4008e39aeaa137bb54ff48ca2d11748083a971a` with the external
browser-driver candidate. No ordinary Roots source was changed.

## Observed problem

A real browser customer scenario saved a profile name, submitted an empty name,
and received the expected validation outcome with unchanged API persistence.
Correcting the field back to the already persisted name then failed with
`unexpected_destination`. The pinned app kept its prior “Profile saved” notice,
so the legacy model classified `Profile::Editing(Saved)`, while its `profile_edit`
outcome accepted only `Ready` or `Draft`.

The initial run demonstrated this through the real viewer/controller/browser,
API and disposable PostgreSQL fixture. Its failure is retained in
`artifacts/roots/browser-initial-results.json`. A focused engine regression then
failed at the same model boundary (`profile-correction-red.tap`).

## Ownership and bounded fix

This is a customer model interpretation issue. It does not require changing the
shared execution rules or the application, and it does not imply that a new save
occurred. The Roots adapter now supplies a boolean read-only assertion that the
actual profile field equals the requested edit. The customer model recognizes
that exact evidence when the resulting state retains the previous saved notice,
and reports that the field matches, without inferring persistence.

Missing field-match evidence still rejects the unsupported legacy transition.
Six customer structural/model checks pass, including the regression and the
missing-evidence negative case (`profile-correction-green.tap`). Browser rerun and
final package identity belong to `browser-results.json`; do not infer their status
from this model-test result.

The change is staged only in the isolated consumer. Everyday Roots dependency and
entrypoint promotion remains a separate integration task.
