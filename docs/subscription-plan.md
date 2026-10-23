# Historical subscription proposal — deferred

This preserves the **2026-10-06** discussion for context. It is not a current
paid offer or a restriction on the Apache-2.0 local core. The later decision to
prepare Daedlo for open-source contribution does not define a new commercial
boundary. Any hosted service, pricing or paid feature scope needs a new explicit
product decision. See [licensing scope](licensing.md).

The discussed release was the local Rust/Node Daedlo workbench, its live viewer,
agent instructions and safe package-update workflow. Self-service onboarding,
accounts and payment are not prerequisites for that release or customer trials.

## Decisions recorded at that time

- Hosting: Cloudflare.
- Authentication: WorkOS with Google login.
- Payments: Stripe.
- Offer: one plan at USD 20 per seat per month, for individuals and businesses.
- A prospective five-seat team would pay USD 100 per month. This is not contracted
  revenue. Customer names and account details do not belong in release artifacts.

Before implementing this phase, define the exact product access a seat purchases,
billing ownership, seat assignment and cancellation/recovery behavior. Reuse the
existing driver experience. A separate report/review product is not an accepted
requirement for the local release.

An earlier companion prototype is preserved in ignored local artifacts, outside
active workspace dependencies and the release package. It is incomplete and has
not been verified against real providers or through its browser flows. No hosted
service, live login, subscription charge or customer invitation was deployed.

Resume that prototype only after a new scope decision. Existing customer
integrations retain their accepted driver and local data throughout.
