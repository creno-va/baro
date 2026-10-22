# @baro/client-core

React-free client view types, progress text, session generation and client initialization cache.
Types consume canonical `@baro/contracts` sources. A session generation invalidates pending
results after an identity transition; it never grants permissions or replaces fresh server checks.

Web compatibility facades stay at `src/client/api/types.ts` and `workspace-progress.ts`.
Mobile UI stays in `apps/mobile`; this package contains no routing, environment reads or IO.
Run `bun run clients:check` and `bun run mobile:check`.
