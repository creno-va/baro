# Native file processor startup repair

Scope: [#458](https://github.com/creno-va/baro/issues/458), independent of RN/native
app ownership and the file publication CAS repair.

In actual preview a74835b, the two-page synthetic PDF completed its first extract
and interpretation, then its second extract failed at13:00:58UTC. The only native
diagnostic was startup/unknown5354ms. Audio reached saved interpretation and later
failed coverage publication with STALE_REVISION; that is a separate DB fence failure.
The precise underlying platform startup cause is not established. Neither result
attests transcript accuracy, complete PDF processing or video success.

Cloudflare documents temporary allocation unavailability after destroy and the
[direct Container API migration](https://developers.cloudflare.com/containers/guides/migrate-to-durable-object-container-api/).
The same exported FileProcessorContainer, Worker/binding, image, namespace and
migration tags remain. There is no new provider/model, container application,
physical capacity, database migration or installed mobile DTO. The SDK dependency
stays installed to avoid unrelated lock/native-input changes, but runtime lifecycle
no longer imports its shared monitor/alarm state.

The direct startup helper separates allocation from readiness within the existing
15-second allocation and20-second total preparation limits. At300ms intervals,
only the platform's confirmed unavailable-allocation condition permits another
start command (maximum50); readiness is bounded to67 health polls with5-second
per-ping bounds. A VM/port already observed followed by process exit, a provider
rate refusal or unknown startup/configuration error does not restart processing.
No source bytes are sent before readiness and a live current monitor are checked.
Each unit owns its monitor generation, so an older unit's late completion cannot
clear the new monitor. Abort interrupts even a transport ignoring its signal.

Native Internet remains disabled and environment variables empty. The existing
durable physical slot stays1, with exact-token release only after confirmed destroy.
Native inactivity remains5 minutes. A persisted actual cleanup deadline protects
against a discarded request/DO restart; stale alarms preserve a future deadline,
expired or legacy missing-deadline alarms stop the process, and alarm retry actions
retain the earlier retryCount<=3 limit. Failed cleanup preserves tokens/holds.
Existing revocation and capacity records are retained; no observation timestamp,
cost amount or unknown execution receipt is changed.

Local focused validation passed40 tests across6 files. The12 startup tests use an
explicit synthetic clock/native port and cover transient allocation, port readiness,
real exit/rate refusal,15s/20s limits, cancellation, stale health output and a late
prior monitor. The actual exported class also runs through real workerd DO/RPC and
SQLite transactions with only ctx.container mocked. Its test covers two owners of
the slot, fenced orphan cleanup, the same named attempt's next unit, future/expired
and legacy alarms and the retry cap. No actual Cloudflare VM or paid AI success is
claimed by these local tests. Fresh integrated validation, exact-head CI/deployment
and actual resumed PDF/audio/video acceptance are still required.
