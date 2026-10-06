# Subscription portal — separate later phase

Updated 2026-10-06 following the product owner's scope decision.

The current release is the local Rust/Node browser-driver, its live viewer,
agent instructions and safe package-update workflow. Self-service onboarding,
accounts and payment are not prerequisites for that release or customer trials.

## Recorded decisions for the later portal

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

Resume that prototype only within the agreed later portal scope. Existing customer
integrations retain their accepted driver and local data throughout.
