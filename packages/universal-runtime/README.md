# Daedlo Universal runtime

This companion to `@daedlo/universal@0.1.0-alpha.6` provides guarded browser
sessions and the version-1 live run journal capability. Install this package
from the versioned Universal release assets in a dedicated integration directory.
Use Node 22.23.4 or Node 24.22.2. The package depends on Playwright 1.65.0.
An integration that launches Chromium must separately install its matching
browser and provide its accepted Rust model and browser adapter.

```js
import {
  createDriverSession,
  RUNTIME_CAPABILITIES,
} from "@daedlo/universal-runtime";
```

Supply `runJournal.startRun` and `runJournal.beforeEffect` when you create the
session, then persist the completed report for the same run through the
Universal writer. The recorder example in the release guide covers registration,
observing the result, independent application readback and closing the writer.
Storage-only repair retries the writer. Each new application command requires
a fresh observation and the integration's authorization.

The command-line entry is `daedlo-universal-runtime`. A plain CLI project uses
the integration's session factory to supply its journal. The default adapter-only
session does not start recording automatically. For the typed interfaces see
`src/index.d.ts`. The complete release instructions accompany the download.

This package includes the Apache-2.0 license, preserved MIT terms and third-party
notices. The application retains ownership of its models, data and adapters.
