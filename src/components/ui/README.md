# Shared BARO UI

The current web design contract is docs/design/HEADLESS-WEB-UI.md and ADR-0022 (#799).
@headlessui/react 2.2.10 supplies the actual interaction primitives. UI modules own presentation,
keyboard/focus behavior and compatibility adapters; domain owners retain API/session/epoch/CAS state.

design-system.css owns semantic themes and common controls. Case workbench CSS owns spatial layout.
AppLayout and CaseWorkbenchLayout use the same sidebar system. Non-landing BaseLayout initializes
light/dark/system before first paint using the existing hash CSP mechanism. Root theme tokens also
cover Headless portals. The landing, native app and exported documents remain separate.

Use Button/ActionButton, Input/Textarea/Select (Listbox), RadioGroup, Dialog/Sheet/Modal,
Disclosure/DisclosureSummary, Tabs, Popover, ThemeToggle and Progress. Never add a visible native select,
dialog/details, progress or checkbox/radio, nor window.confirm. Hidden file access and platform
page-unload protection retain their browser security boundary. Labels remain semantic HTML.

Headless UI owns modal inertness, Escape, focus lock and restoration. Domain callbacks can refuse
dismissal. Responsive material panels keep the same editor DOM and preserve controlled input.
Discard confirmation cancels on session invalidation/path changes/source removal and the caller
must recheck its existing epoch/owner before continuing. No UI transition starts paid work.

Keep branding and states accessible in both themes; use reduced motion. Never relax CSP for a widget.
Evidence, exact SHA and preview/full status are recorded on #799; fixture success is not real OAuth.
