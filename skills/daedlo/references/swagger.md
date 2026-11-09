# Drive a Swagger/OpenAPI API explorer

Use the reusable Swagger integration when the user asks Daedlo to drive an API
through Swagger UI. Read the selected source/package's compatibility table and
API contracts; do not assume a published kit includes this source candidate.
In the source checkout, start at `integrations/swagger/README.md`.

Discover the actual OpenAPI document and Swagger UI version. Use method/path
identity rather than assuming operationId exists or resembles a Roots route.
Inspect catalog capability reasons. The current JSON reader supports OpenAPI
3.0, 3.1 and 3.2; QUERY/custom methods may be browsable but unavailable for
execution. Unsupported encodings, assertions or versions must stay explicit.

Reuse the generic Rust model and Node adapter. Configure the project's docs and
schema URLs, exact allowed operations, separate write permissions and isolated
authentication. Relative server URLs resolve against the schema retrieval URL.
Keep secrets and synthetic credentials outside static profiles and shared reports.
The browser may visibly contain private payloads; inspect before sharing images.

Use the shared select → prepare → execute flow and canonical read recipes.
Do not bypass the guarded browser with raw HTTP calls to manufacture an action
pass. Read-only independent HTTP/database evidence can verify the result.
Keep execution, response-contract validity, business outcome and persistence
separate. A write needs the customer's exact-operation readback or reconciliation
contract before it can be marked saved. Do not infer retry safety from OpenAPI.

Validate another application with the same reusable modules and a different
profile. Record exact schema/UI/runtime/engine identities and unsupported
capabilities. Real application acceptance, independent conformance fixtures and
installed-package verification remain distinct evidence. Never port customer
routes, session semantics or business assertions into the generic driver.
