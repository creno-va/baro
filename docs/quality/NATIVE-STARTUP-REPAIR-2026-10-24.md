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
claimed by these local tests. Final integrated89b0c063 passed frozen install,
quick302/full4206 tests across385 files (172656 assertions), build and
[CI40102057543](https://github.com/creno-va/baro/actions/runs/40102057543). Normal
PR494 squash produced main da9cc6d; mainCI40102819415 and same-SHA
[preview40103079485](https://github.com/creno-va/baro/actions/runs/40103079485)
passed. Its configuration receipt is at14:38:57.480Z.

An explicit retained-audio retry at14:40:01Z passed native extract10.195s,
interpret6.570s and unit preparation2.292s, then publication preparation failed
with DB_OPERATION_FAILED after3.248s. This proves one actual direct-API extract,
not a multi-unit restart or accurate transcript/ready file. No unchanged-condition
retry was sent. PDF/video acceptance remains outstanding. The subsequent retained
snapshot-version collision regression is recorded in the AI harness repair log.
