# Security policy

Report a suspected vulnerability privately to
[support@daedlo.com](mailto:support@daedlo.com) with the subject
“Daedlo security report”. Do not open a public issue containing an unpatched
vulnerability, credentials or customer data.

Include the affected version or commit, environment, a minimal reproduction,
expected and observed behavior, and the potential impact. Use a disposable
fixture. Keep raw cookies, tokens, private URLs and application records out of the
initial message; the maintainer can arrange a suitable way to exchange any
additional material needed.

Daedlo is an alpha project. Maintainers assess reports against the current source
and latest published prerelease. There is no promised response time, bounty or
maintenance window for older versions. Updates to old releases are considered
case by case; published release bytes and receipts retain their original identity.
Coordinate disclosure with the maintainer while a report is investigated.

## Security boundaries

Daedlo runs locally. Customer adapters, project modules, browser handlers and
managed-update build/validation hooks are trusted code, not sandboxed plugins.
Use code and publisher keys you trust. The guarded execution contract validates
observations and action boundaries; it does not replace the application's own
authentication, authorization or persistence guarantees.

Keep the viewer and local update screen on their intended loopback interface.
Local update-screen URLs contain private tokens. Do not expose them through a
public proxy or attach them to an issue. Checksums establish identity only when
the expected digest is independently trusted. Read the
[contracts](docs/contracts.md) and [update trust guide](docs/ninja-update.md) for
implemented boundaries.

For ordinary bugs and setup questions, use [SUPPORT.md](SUPPORT.md).
