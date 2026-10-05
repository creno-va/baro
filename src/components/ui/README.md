# Shared UI

Source-owned shadcn/ui conventions (MIT license in `LICENSE.shadcn`): semantic
CSS tokens, `data-slot`, `cn`, CVA button variants, cards and native form controls.
Components use React 19 and Tailwind 4 without a framework migration.

`Dialog`/`Sheet` use the native dialog backend for modal focus containment,
Escape, focus restoration and scroll locking with static classes. They do not
inject style tags or weaken the built Worker CSP. `Tabs` uses manual keyboard
activation. Interactive Astro imports require `client:load`.

`AppNavigation` accepts a trusted role, current pathname and an explicit list of
available routes. The component grants no role and performs no authentication;
unavailable future routes are omitted. All logo usages point to `/brand/logo.svg`.
Decorative Lucide icons are hidden from assistive technology; icon buttons have
an accessible label. StatePanel supports loading/empty/error/limit/permission/pending.

For tests only, `BARO_UI_TEST_FIXTURE=true` injects a synthetic showcase. This
flag must not be set for deployment. Ordinary builds have no showcase route.
