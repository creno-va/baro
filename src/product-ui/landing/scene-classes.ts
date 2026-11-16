import { cn } from "../utils";

/** Static presentation uses Tailwind; scene selectors retain only responsive and motion math. */
export const sceneUtilities: Record<string, string> = {
  "blue-reveal": "relative [background:#fff] [color:#192d49]",
  "blue-reveal-pin": "overflow-clip",
  "blue-reveal-opening": "text-center",
  "blue-reveal-eyebrow": "[margin:0_0_23px] [color:#316cbf] [font-weight:650]",
  "blue-reveal-opening-note": "[margin:25px_0_0] [color:#576e8c] [line-height:1.8]",
  "blue-reveal-experience": "relative [color:#fff]",
  "blue-reveal-heading": "[max-width:1100px]",
  "blue-reveal-wordmark": "items-center [gap:12px]",
  "blue-reveal-tabs": "[margin:0_auto_21px] [grid-template-columns:repeat(4,_minmax(0,_1fr))]",
  "blue-reveal-tab": "border-0 p-0 [border-radius:15px] cursor-pointer",
  "blue-reveal-tab-face": "relative flex items-center justify-center [border:1px_solid_#ffffff5e]",
  "blue-reveal-tab-icon": "grid [place-items:center] shrink-0",
  "blue-reveal-tab-label": "[font-weight:600] [letter-spacing:-0.025em] whitespace-nowrap",
  "blue-reveal-tab-number": "absolute [right:7px] [top:4px] [font-size:6px]",
  "blue-reveal-window":
    "[max-width:1100px] [margin:auto] [border:1px_solid_#fff9] [background:#fff] [color:#304863] overflow-clip",
  "blue-reveal-windowbar":
    "flex items-center [gap:15px] [border-bottom:1px_solid_#e2e9f4] [background:#f5f8fd]",
  "blue-reveal-window-dots": "[gap:5px]",
  "blue-reveal-window-location":
    "[margin:auto] flex items-center [gap:5px] [color:#526c8e] [font-size:8px]",
  "blue-reveal-example": "[margin-left:auto] [font-size:8px] [color:#597394]",
  "blue-reveal-sidebar":
    "relative [padding:21px_15px_62px] [border-right:1px_solid_#e9eff8] [background:#f7faff]",
  "blue-reveal-app-brand": "flex items-center [gap:7px] [margin:0_6px_27px] [color:#2964b6]",
  "blue-reveal-new":
    "flex items-center [gap:8px] [padding:10px_12px] [margin-bottom:24px] [background:#fff] [border:1px_solid_#dce6f5] [border-radius:9px] [color:#446997] [font-size:10px]",
  "blue-reveal-sidebar-label": "block [margin:0_8px_10px] [color:#536e91] [font-size:8px]",
  "blue-reveal-case":
    "flex items-center [gap:7px] [padding:11px_9px] [color:#2f6ac6] [background:#e8f1ff] [border-radius:9px] [font-size:9px] [font-weight:600]",
  "blue-reveal-case-muted":
    "flex items-center [gap:7px] [padding:15px_9px] [color:#526c8e] [font-size:9px]",
  "blue-reveal-sidebar-bottom":
    "absolute [left:20px] [right:17px] [bottom:17px] flex items-center [gap:8px] [color:#526d90] [font-size:9px]",
  "blue-reveal-avatar":
    "grid [place-items:center] [width:27px] [height:27px] [border-radius:50%] [background:#e0ebfb] [color:#386bad] [font-size:10px]",
  "blue-reveal-app-main": "min-w-0",
  "blue-reveal-app-top":
    "items-center justify-between [gap:10px] [border-bottom:1px_solid_#edf1f7]",
  "blue-reveal-breadcrumb":
    "flex items-center [gap:5px] [margin-bottom:6px] [color:#526c8e] [font-size:8px]",
  "blue-reveal-app-state": "items-center [gap:5px] [color:#536f95] [font-size:8px]",
  "blue-reveal-panel-title": "justify-between",
  "blue-app-chat-main": "min-w-0",
  "blue-app-greeting": "items-center [gap:10px]",
  "blue-app-chat-bubble":
    "[width:fit-content] [margin:0_0_15px_auto] [color:#fff] [background:#2865ce] [border-radius:13px_13px_3px_13px] [line-height:1.65]",
  "blue-app-chat-reply": "flex items-start [gap:8px]",
  "blue-app-input":
    "flex items-center [gap:9px] [border:1px_solid_#dfe8f4] [border-radius:10px] [color:#526c8e]",
  "blue-app-input-send":
    "grid [place-items:center] [margin-left:auto] [border-radius:7px] [color:#fff] [background:#568cec]",
  "blue-app-facts":
    "[align-self:start] [padding:16px_14px] [background:#f5f9ff] [border:1px_solid_#e4edfa] [border-radius:12px]",
  "blue-app-small-heading": "block [color:#4b6b96] [font-size:9px] [font-weight:600]",
  "blue-app-files-intro": "justify-between items-center [margin-bottom:8px]",
  "blue-app-file-row": "items-center [border-bottom:1px_solid_#eaf0f8]",
  "blue-app-file-icon": "grid [place-items:center] [width:35px] [height:35px] [border-radius:10px]",
  "blue-app-file-tag":
    "[color:#526c8e] [background:#f2f6fc] [border-radius:5px] [padding:4px_7px] [font-size:8px]",
  "blue-app-material-note": "flex [gap:5px] [color:#526c8e] [margin:12px_0_0]",
  "blue-app-timeline-intro": "items-center justify-between [gap:10px] [margin:0_0_15px]",
  "blue-app-report-paper": "[border:1px_solid_#e2eaf6] [background:#fff] [border-radius:12px]",
  "blue-app-review": "[padding:15px_0_0]",
  "blue-reveal-panel-footer": "justify-between [border-top:1px_solid_#edf1f7]",
  "blue-reveal-bottom":
    "justify-between items-center [gap:12px] [max-width:1100px] [margin:17px_auto_0] [color:#e0edff]",
  "ceo-greeting": "relative [background:#f5f6f8] [color:#25364e]",
  "ceo-introduction": "[max-width:1130px]",
  "ceo-eyebrow": "[font-weight:650]",
  "ceo-scene": "items-start",
  "ceo-portrait": "min-w-0 m-0",
  "ceo-letter": "min-w-0 p-0",
  "ceo-signature": "flex-col [margin-top:26px]",
  "ceo-footer": "[padding-top:36px] text-center",
  "ceo-start":
    "inline-flex items-center [gap:11px] [min-height:48px] [color:#2b64b9] [font-size:14px] [font-weight:650] no-underline",
  "clarity-section": "isolate",
  "clarity-pin": "[max-width:1180px] [margin:0_auto]",
  "clarity-heading": "relative [z-index:3]",
  "clarity-eyebrow": "[margin:0_0_23px] [color:#8ab6ff] [font-weight:650]",
  "clarity-description": "m-0 [color:#aebbd1] [letter-spacing:-0.025em]",
  "clarity-controls": "relative [z-index:5] [margin:25px_0_0]",
  "clarity-topics": "flex flex-wrap",
  "clarity-topic":
    "[border:1px_solid_#38485f] [border-radius:99px] [font-weight:600] cursor-pointer",
  "clarity-visual": "relative [max-width:1120px]",
  "clarity-input":
    "items-center [border:1px_solid_rgb(151_183_232_/_20%)] [letter-spacing:-0.025em]",
  "clarity-brand": "[z-index:2] [width:140px] text-center",
  "clarity-brand-core":
    "relative [place-items:center] [margin:0_auto_13px] [border:1px_solid_rgb(255_255_255_/_75%)] [background:linear-gradient(145deg,_#fff,_#dceaff)]",
  "clarity-brand-orbit":
    "absolute [left:50%] [border:1px_solid_rgb(111_162_248_/_16%)] [border-radius:50%] pointer-events-none",
  "clarity-brand-orbit-two": "[border-color:rgb(111_162_248_/_8%)]",
  "clarity-results": "[align-items:stretch]",
  "clarity-help":
    "isolate min-w-0 overflow-hidden [border:1px_solid_rgb(181_202_227_/_20%)] [background:#334354]",
  "clarity-help-shade":
    "absolute [inset:0] [background:linear-gradient(180deg,_transparent_32%,_rgb(10_23_41_/_84%))]",
  "clarity-help-copy": "absolute",
  "clarity-output":
    "relative min-w-0 [border:1px_solid_rgb(192_215_255_/_25%)] [background:linear-gradient(120deg,_#fcfdff,_#eff5ff)]",
  "clarity-output-label": "flex items-center [font-weight:650]",
  "clarity-result-detail": "[color:#4b6b96]",
  "clarity-scene-footer": "flex items-center flex-wrap [margin:27px_auto_0]",
  "clarity-phase": "items-center [gap:9px]",
  "clarity-phase-track": "overflow-hidden",
  "clarity-play": "[padding:10px_16px] [border:1px_solid_#455f85] [color:#dce9ff] cursor-pointer",
  "clarity-start": "[padding:10px_0]",
  "clarity-note": "[margin:18px_0_0] [color:#8c9db7]",
  "demo-lab": "[background:linear-gradient(180deg,_#f3f7fe,_#f9fbff_65%,_#fff)] [color:#202b3d]",
  "demo-heading": "text-center [max-width:750px]",
  "demo-example-badge":
    "inline-flex items-center [gap:7px] [padding:9px_14px] [border:1px_solid_#cbdcfc] [border-radius:40px] [background:#eaf2ff] [color:#245fc0] [font-weight:650] [margin-bottom:24px]",
  "demo-scenarios": "[margin:0_0_28px] text-center min-w-0",
  "demo-workspace": "[border:1px_solid_#dce5f3] [background:#fff] overflow-clip",
  "demo-app-header": "flex items-center justify-between [border-bottom:1px_solid_#edf1f7]",
  "demo-app-brand": "items-center [gap:8px]",
  "demo-restart":
    "inline-flex items-center [gap:6px] [min-height:44px] [padding:10px_12px] border-0 [border-radius:10px] [font-size:12px] [color:#526176] cursor-pointer",
  "demo-case-heading": "flex justify-between",
  "demo-case-eyebrow": "[color:#657081]",
  "demo-case-state": "[border-radius:7px] [background:#f0f5ff] [color:#245fc0] whitespace-nowrap",
  "demo-progress": "flex items-center",
  "demo-tabs": "[border-bottom:1px_solid_#e9edf3]",
  "demo-panel-heading": "[margin-bottom:25px]",
  "demo-conversation": "grid [gap:20px] [padding:8px_0_24px]",
  "demo-speaker": "[font-size:10px] [font-weight:600] [color:#526176]",
  "demo-message-user": "[background:#edf4ff] [border-radius:20px_20px_5px_20px] [color:#244878]",
  "demo-message-baro": "flex items-start [color:#36465c]",
  "demo-baro-avatar":
    "grid [place-items:center] [flex:0_0_35px] [background:#f0f5ff] [margin-top:6px]",
  "demo-answer-group": "grid [gap:20px]",
  "demo-found-fact":
    "inline-flex [gap:7px] [margin-top:14px] [padding:9px_12px] [border-radius:9px] [background:#f2f7ff] [color:#285fae]",
  "demo-panel-actions":
    "flex justify-between flex-wrap [padding-top:23px] [margin-top:10px] [border-top:1px_solid_#edf1f6]",
  "demo-action-hint": "[color:#657081] [font-size:11px]",
  "demo-secondary": "[color:#526176]",
  "demo-files": "grid [gap:12px] min-w-0 border-0 m-0 p-0",
  "demo-file-card":
    "relative flex items-center [border:1px_solid_#dce5f1] [border-radius:17px] cursor-pointer",
  "demo-file-icon":
    "[place-items:center] [width:46px] [height:52px] shrink-0 [border-radius:12px] [background:#edf4ff] [color:#3475d7]",
  "demo-file-copy": "grid [gap:5px] min-w-0 [overflow-wrap:anywhere]",
  "demo-file-check":
    "grid [place-items:center] [margin-left:auto] shrink-0 [border-radius:50%] [background:#2364e8] [color:#fff]",
  "demo-selection-note":
    "flex items-center [gap:8px] [margin:18px_0_24px] [color:#526176] [font-size:12px]",
  "demo-timeline": "list-none [border-left:1px_solid_#d6e5fa]",
  "demo-timeline-dot":
    "absolute [top:4px] [width:11px] [height:11px] [border-radius:50%] [background:#3182f6]",
  "demo-timeline-notice":
    "flex items-start [gap:9px] [background:#f6f8fc] [color:#526176] [border-radius:12px] [line-height:1.8]",
  "demo-report-top":
    "justify-between [padding-bottom:19px] [margin-bottom:20px] [border-bottom:1px_solid_#eaf0f7]",
  "demo-report-label":
    "block [color:#34465e] [font-size:12px] [font-weight:650] [margin-bottom:10px]",
  "demo-input-note": "[font-size:10px] [color:#657081] [line-height:1.8] [margin:10px_0_23px]",
  "demo-report-file":
    "[padding:8px_11px] [border:1px_solid_#d9e7fc] [border-radius:8px] [color:#3567b0] [background:#f2f7ff] [font-size:11px] [overflow-wrap:anywhere]",
  "demo-report-question": "[border-top:1px_solid_#eaf0f7] [margin-top:22px] [padding-top:19px]",
  "demo-review": "border-0 p-0 [margin:25px_0] min-w-0",
  "demo-complete":
    "flex items-center flex-wrap [border:1px_solid_#c7ddff] [border-radius:17px] [background:#f1f7ff]",
  "demo-complete-icon":
    "grid [place-items:center] [flex:0_0_47px] [border-radius:50%] [color:#2465d3] [background:#e0edff]",
  "demo-app-footer":
    "flex items-start [gap:7px] [border-top:1px_solid_#edf1f7] [background:#fbfcff] [color:#657081] [line-height:1.7]",
  "demo-fallback": "[border:1px_solid_#dce5f3] [border-radius:25px] [background:#fff]",
  "demo-sr-only":
    "absolute [width:1px] [height:1px] p-0 [margin:-1px] overflow-hidden whitespace-nowrap border-0",
  finale: "isolate overflow-clip",
  "finale-pin": "[width:min(1180px,_100%)] [margin:0_auto]",
  "finale-heading": "relative",
  "finale-eyebrow": "[margin:0_0_20px] [color:#9dbde9] [font-weight:650] [letter-spacing:0.16em]",
  "finale-opening": "m-0 [letter-spacing:-0.05em]",
  "finale-introduction": "[margin:17px_0_0] [color:#abbdd7] [letter-spacing:-0.025em]",
  "finale-scene": "relative [margin:45px_auto_0]",
  "finale-inputs": "[z-index:2]",
  "finale-feature": "flex items-center",
  "finale-feature-icon": "grid [place-items:center] [flex:0_0_46px]",
  "finale-feature-number": "block [letter-spacing:0.06em] [font-weight:650]",
  "finale-orbits": "[top:50%] [left:50%] [width:min(60vw,_660px)] pointer-events-none",
  "finale-brand-token": "absolute [z-index:1] [top:50%] [left:50%] text-center",
  "finale-app": "[width:270px]",
  "finale-app-device":
    "relative [width:270px] [height:440px] [padding:16px_17px_15px] [border:6px_solid_#22354e] [border-radius:37px] [background:#fff] [color:#334b6d]",
  "finale-app-camera":
    "absolute [top:9px] [left:50%] [width:68px] [height:17px] [border-radius:20px] [background:#192b43]",
  "finale-app-status": "flex justify-between [margin:0_5px_15px] [font-size:8px]",
  "finale-app-heading":
    "flex items-center [gap:6px] [padding:0_0_12px] [border-bottom:1px_solid_#e5edf7]",
  "finale-app-content": "flex flex-col [gap:13px] [padding-top:15px]",
  "finale-app-message":
    "[align-self:flex-end] [padding:9px_12px] [border-radius:13px_13px_3px_13px] [background:#2e6cdd] [color:#fff] [font-size:10px] [line-height:1.65]",
  "finale-app-facts":
    "[padding:11px] [border:1px_solid_#dce8fa] [border-radius:12px] [background:#f3f7fd]",
  "finale-app-input":
    "absolute [right:17px] [bottom:17px] [left:17px] flex justify-between items-center [padding:9px_10px] [border-radius:10px] [background:#edf3fc] [color:#637fa2] [font-size:8px]",
  "finale-app-orbit-note":
    "absolute items-center [gap:7px] [padding:13px_17px] [border:1px_solid_rgb(255_255_255_/_80%)] [border-radius:14px] [background:#f3f7ff] [color:#376195] [font-size:10px] whitespace-nowrap",
  "finale-app-orbit-note-one": "[top:80px] [right:-140px]",
  "finale-app-orbit-note-two": "[bottom:100px] [left:-150px]",
  "finale-message-kicker": "[margin:0_0_22px] [color:#a7c6f0] [font-weight:550]",
  "finale-message-line": "[margin:25px_0_0] [letter-spacing:-0.035em]",
  "finale-message-description": "[margin:17px_0_0] [color:#aebfd8]",
  "finale-scene-caption":
    "justify-center items-center [gap:11px] [margin:27px_0_0] [color:#a3b7d3] [line-height:1.6]",
  "finale-actions": "relative [z-index:5] flex items-center flex-wrap [margin:27px_auto_0]",
  "finale-primary":
    "inline-flex items-center justify-center [border-radius:14px] [color:#285fae] [line-height:1.6] [font-weight:700] no-underline",
  "finale-replay": "items-center [padding:10px_0] border-0 [background:transparent] cursor-pointer",
  "finale-service-note": "[flex:0_0_100%] m-0 [color:#9cb0ce]",
  "everyday-future": "[background:#fff]",
  "future-introduction": "[max-width:1240px]",
  "future-eyebrow": "[font-weight:650]",
  "future-introduction-body": "m-0 [color:#586d88] [letter-spacing:-0.025em]",
  "future-collage":
    "[grid-template-columns:minmax(0,_0.86fr)_minmax(0,_1.2fr)_minmax(0,_0.86fr)] items-start [width:min(1440px,_100%)] [margin:0_auto]",
  "future-photo": "min-w-0",
  "future-photo-window": "isolate overflow-hidden",
  "future-photo-index": "absolute [z-index:1] [color:#fff] [letter-spacing:0.13em]",
  "future-films": "[max-width:1440px] [margin:0_auto]",
  "future-film-shell": "relative isolate overflow-hidden",
  "future-film-media": "[z-index:-2]",
  "future-film-shade": "absolute [z-index:-1] [inset:0]",
  "future-film-overline": "[font-weight:550] [letter-spacing:0.12em]",
  "future-film-caption": "block",
  "future-video-toggle":
    "absolute [z-index:4] items-center [gap:8px] [border:1px_solid_rgb(255_255_255_/_33%)] [border-radius:30px] [color:#fff] cursor-pointer",
  "future-film-ai": "absolute [color:#c7d6e2]",
  "future-film-conversation": "items-center",
  "future-conversation-steps": "[border-top:1px_solid_#e0e8f2]",
  "future-conversation-film": "relative isolate min-w-0 overflow-hidden [background:#a4b1b7]",
  "future-conversation-shade":
    "absolute [z-index:-1] [inset:0] [background:linear-gradient(0deg,_rgb(18_37_52_/_67%),_transparent_55%)]",
  "future-conversation-film-label":
    "absolute [color:#fff] [font-weight:600] [line-height:1.5] [letter-spacing:-0.04em]",
  "future-vision": "isolate overflow-hidden text-center",
  "future-vision-inner": "[max-width:1040px] [margin:0_auto]",
  "future-vision-mark": "block [margin:0_auto_40px]",
  "future-vision-body": "[margin:43px_0_0] [color:#9fb3d0] [letter-spacing:-0.025em]",
  "future-vision-actions": "flex justify-center items-center flex-wrap",
  "future-cta": "[color:#285fae]",
  "future-vision-note": "[margin:30px_0_0] [color:#8a9fbf] [line-height:1.8]",
  "journey-pin": "overflow-clip isolate",
  "journey-film-stage": "[z-index:-3]",
  "journey-film-shade": "absolute [inset:0]",
  "journey-eyebrow": "items-center [gap:9px] [font-weight:600]",
  "journey-actions": "flex items-center",
  "journey-primary":
    "inline-flex items-center justify-center [gap:17px] [font-weight:700] [border-radius:16px]",
  "journey-explore": "inline-flex items-center [gap:8px] [font-weight:600]",
  "journey-bottom": "absolute justify-between [z-index:4]",
  "journey-portal":
    "absolute [z-index:-2] [inset:0] [background:radial-gradient(ellipse_at_60%_45%,_#d6e6ff,_#f7f9ff_65%)] [border-radius:var(--journey-portal-radius,_45%)]",
  "journey-app":
    "relative [margin:0_auto] [grid-template-columns:1fr_1fr] items-center [color:#223049]",
  "journey-app-copy": "[padding-bottom:12px]",
  "journey-device":
    "[width:315px] [height:615px] [border-radius:46px] [border:7px_solid_#263244] [background:#fff] [padding:18px_18px_12px]",
  "journey-device-camera":
    "absolute [top:9px] [left:50%] [width:84px] [height:21px] [background:#152133] [border-radius:30px]",
  "journey-device-status":
    "flex justify-between [margin:0_8px_20px] [font-size:9px] [color:#24354b]",
  "journey-app-header":
    "flex items-center [gap:6px] [padding-bottom:15px] [border-bottom:1px_solid_#e8edf5]",
  "journey-app-body": "flex flex-col [gap:16px] [padding-top:22px]",
  "journey-message": "flex items-start [gap:8px] [font-size:11px] [line-height:1.8]",
  "journey-spark":
    "inline-flex [border-radius:10px] [padding:8px] [background:#edf3ff] [color:#3974ed]",
  "journey-message-ai": "[color:#455a76]",
  "journey-message-me":
    "[align-self:flex-end] [padding:11px_14px] [background:#2865ce] [color:white] [border-radius:15px_15px_4px_15px]",
  "journey-fact":
    "[padding:14px] [border:1px_solid_#dde9ff] [background:#f6f9ff] [border-radius:14px]",
  "journey-result": "items-center [gap:10px] [padding:10px] [border-top:1px_solid_#edf1f7]",
  "journey-input":
    "absolute [bottom:20px] [left:18px] [right:18px] flex items-center justify-between [background:#f3f6fb] [padding:11px_10px] [border-radius:14px] [color:#536780] [font-size:9px] [min-height:42px]",
  "journey-app-note":
    "absolute items-center [gap:13px] [padding:18px_24px] [background:#ffffffec] [border:1px_solid_#fff] [border-radius:20px] [line-height:1.7]",
  "journey-chapters": "absolute [top:30px] [right:35px] [gap:10px] items-center [font-size:10px]",
  "journey-anchor": "absolute [top:72%]",
  landing: "[background:#fff] overflow-clip",
  "landing-main": "w-full [max-width:none] p-0 m-0",
  "landing-header": "sticky [top:0] [z-index:50] [border-bottom:1px_solid_rgb(0_0_0_/_4%)]",
  "landing-nav-wrap": "[max-width:1240px] h-full [margin:auto] flex items-center justify-between",
  "landing-nav": "[font-weight:550]",
  "landing-scroll-progress":
    "absolute [bottom:-1px] [left:0] w-full [height:2px] [background:var(--landing-blue)]",
  "landing-eyebrow": "[font-weight:650] [letter-spacing:-0.02em] [margin:0_0_25px]",
  "landing-body": "[color:#626f80] [letter-spacing:-0.02em] [margin-bottom:24px]",
  "landing-intro": "text-center",
  "landing-journey": "justify-center",
  "landing-kicker": "[color:var(--landing-blue)]",
  "landing-text-link":
    "inline-flex items-center [gap:9px] [min-height:44px] [color:var(--landing-blue)] [font-weight:650]",
  "landing-lawyers": "[background:#f7f9fc]",
  "landing-lawyers-inner":
    "[max-width:1080px] [margin:auto] [grid-template-columns:1fr_1fr] items-center",
  "landing-directory-preview": "[background:#fff]",
  "landing-search-illustration": "flex items-center [background:#f5f7fa] [border-radius:12px]",
  "landing-category-list": "flex-wrap",
  "landing-directory-foot":
    "flex justify-center items-center [padding-top:24px] [border-top:1px_solid_#f0f3f7]",
  "landing-principles": "[max-width:1160px] [margin:auto]",
  "landing-principle-grid": "grid text-left",
  "landing-principle-icon": "[color:#477fe0] flex items-center justify-center [background:#f0f5ff]",
  "landing-faq":
    "[max-width:1080px] [margin:auto] [padding-bottom:150px] [grid-template-columns:1fr_1.35fr]",
  "landing-footer": "[background:#f9fafb]",
  "landing-footer-inner": "[max-width:1160px] [margin:auto]",
  "landing-footer-top": "items-center justify-between [gap:30px]",
  "landing-footer-bottom":
    "flex justify-between [border-top:1px_solid_#e9edf2] [padding-top:24px] [margin-top:32px]",
  "logo-experience": "relative [background:#f6f9ff] [color:#1c2a3d]",
  "logo-experience-sticky": "overflow-clip",
  "logo-experience-inner": "relative [z-index:1] w-full [margin:auto]",
  "logo-experience-glow":
    "absolute [width:850px] [height:850px] [left:-180px] [top:1%] pointer-events-none [background:radial-gradient(circle,_#deecff_0%,_#eaf2ff66_44%,_transparent_70%)]",
  "logo-experience-stage": "relative",
  "logo-feature-tile": "block border-0 p-0 [border-radius:22px] cursor-pointer",
  "logo-feature-tile-face": "relative flex flex-col items-center [border:1px_solid_#e2eafa]",
  "logo-feature-tile-icon": "grid [place-items:center]",
  "logo-feature-tile-label": "[font-weight:650] whitespace-nowrap",
  "logo-feature-tile-number": "absolute [color:#526c8e] [letter-spacing:0.5px]",
  "logo-experience-panels": "[gap:50px_40px]",
  "logo-feature-kicker":
    "items-center [gap:9px] [margin:0_0_13px] [color:#2865ce] [font-weight:650]",
  "logo-feature-description": "[margin:15px_0_0] [color:#61718a] [letter-spacing:-0.3px]",
  "logo-feature-preview":
    "overflow-hidden [background:#fff] [border:1px_solid_#dfe9f8] [min-height:221px]",
  "logo-feature-preview-bar":
    "[height:41px] flex [gap:6px] items-center [border-bottom:1px_solid_#eff3f8]",
  "logo-preview-chat": "[padding:15px_17px]",
  "logo-preview-chat-me":
    "[width:fit-content] [margin:0_0_15px_auto] [padding:10px_13px] [border-radius:12px_12px_3px_12px] [background:#2865ce] [color:white]",
  "logo-preview-chat-baro": "flex [gap:9px] items-start m-0 [line-height:1.7]",
  "logo-preview-input":
    "flex justify-between items-center [margin-top:16px] [padding:9px_12px] [background:#f5f8fd] [border-radius:9px] [color:#526c8e] [font-size:9px]",
  "logo-preview-timeline": "list-none m-0",
  "logo-preview-report-head": "items-center [gap:11px] [margin-bottom:14px]",
  "logo-preview-lawyers": "[padding:16px_17px]",
  "logo-preview-profile": "items-center [gap:12px]",
  "logo-preview-lawyers-note":
    "flex [gap:9px] items-center justify-center m-0 [color:#526c8e] [font-size:9px]",
  "logo-preview-checkbox":
    "grid [place-items:center] [width:15px] [height:15px] [border-radius:4px] [color:white]",
  "logo-feature-benefit": "items-center [gap:6px] [margin:15px_0_0]",
  "logo-feature-cta": "inline-flex items-center [gap:8px] [font-weight:650]",
  "logo-experience-disclaimer": "[color:#526c8e]",
  "logo-experience-mark-turn": "w-full h-full relative",
  "logo-experience-piece": "absolute [inset:0] w-full h-full overflow-visible",
  "logo-experience-intro-icon":
    "[place-items:center] [width:46px] [height:46px] [background:#e9f2ff] [color:#4388ee] [border-radius:16px] [margin-bottom:20px]",
  "logo-experience-scroll": "flex items-center [gap:7px] [font-size:11px] [color:#4b6b96]",
  "landing-menu-dialog":
    "fixed [inset:0] w-full [height:100dvh] [max-width:none] [max-height:none] m-0 p-0 border-0 overflow-hidden [color:#fff]",
  "landing-mobile-menu-panel": "w-full [overflow-y:auto]",
  "landing-menu-content": "flex flex-col items-center justify-center [min-height:100%] text-center",
  "landing-menu-primary": "flex-col w-full",
  "landing-menu-link-arrow":
    "grid [place-items:center] [width:19px] [height:19px] [border-radius:50%] [background:#ffffff20]",
  "landing-menu-secondary":
    "[grid-template-columns:repeat(2,_minmax(0,_1fr))] [width:min(100%,_320px)] [border-top:1px_solid_#ffffff24]",
  "landing-menu-login": "[padding:0_16px] [font-size:14px] [font-weight:620]",
  "landing-menu-dismiss":
    "absolute [z-index:1] [top:max(14px,_env(safe-area-inset-top))] [right:max(20px,_env(safe-area-inset-right))] grid [place-items:center] [width:44px] [height:44px] p-0 border-0 [border-radius:50%] [color:#fff] cursor-pointer",
  "origin-story": "relative [background:#f6f4ee] [color:#23354b]",
  "origin-pin": "isolate overflow-clip",
  "origin-introduction": "[z-index:1] grid [max-width:1280px] [margin:auto]",
  "origin-eyebrow": "[font-weight:650] [letter-spacing:0.07em]",
  "origin-body": "[margin:25px_0_0] [color:#586477] [letter-spacing:-0.025em]",
  "origin-values": "flex flex-wrap [margin:26px_0_0] list-none",
  "origin-photo-stage":
    "grid [grid-template-rows:minmax(0,_1fr)_auto] min-w-0 [min-height:0] w-full [margin:0_auto]",
  "origin-photo-window": "grid [place-items:center] overflow-clip [background:#bca77c]",
  "origin-arrival": "[z-index:3] text-center",
  "origin-arrival-inner": "[max-width:900px]",
  "origin-next-steps":
    "[grid-template-columns:repeat(3,_minmax(0,_1fr))] [max-width:510px] list-none",
  "phone-story": "relative [background:#f5f8ff] [color:#202b3d]",
  "phone-story-sticky": "overflow-clip",
  "phone-story-layout": "relative [z-index:1] [max-width:1140px] [margin:0_auto]",
  "phone-story-halo":
    "absolute [top:4%] [height:90%] [background:radial-gradient(ellipse,_#dceaff_0%,_#edf3ff_39%,_transparent_68%)] pointer-events-none",
  "phone-story-overline":
    "items-center [gap:8px] [margin:0_0_18px] [color:#52647c] [font-weight:600]",
  "phone-story-kicker": "flex items-center [margin:0_0_20px] [color:#2768de] [font-weight:650]",
  "phone-story-heading-accent": "[color:#276af0]",
  "phone-story-description": "[margin:25px_0_0] [color:#526174] [letter-spacing:-0.4px]",
  "phone-story-note": "flex items-start [margin:19px_0_0] [line-height:1.6]",
  "phone-story-link": "inline-flex items-center [gap:9px] [color:#2768de] [font-weight:650]",
  "phone-story-step-number": "[font-size:10px]",
  "phone-story-perspective": "[left:50%] [top:48%] [width:280px] [height:586.56px]",
  "phone-story-device": "relative w-full h-full",
  "phone-story-shell": "absolute [inset:0]",
  "phone-story-shell-facet":
    "absolute [top:50%] [left:50%] [height:31.41px] [margin-top:-15.705px]",
  "phone-story-bevel":
    "[background:linear-gradient(115deg,_#fafbfc,_#b2b7be_25%,_#f2f3f5_46%,_#a8afb6_77%,_#eef0f2)]",
  "phone-story-front": "[padding:4.6px] [background:#15171b]",
  "phone-story-screen":
    "h-full [border-radius:40px] [background:#fff] overflow-clip relative [border:1px_solid_#0d1015]",
  "phone-story-glass": "absolute pointer-events-none [inset:3.8px] [border-radius:41px]",
  "phone-story-back":
    "[background:linear-gradient(132deg,_#e8eaed,_#d1d5d9_32%,_#bfc4ca_70%,_#dbe0e4)]",
  "phone-story-back-finish": "absolute [inset:3px] [border-radius:42px]",
  "phone-story-camera": "absolute [width:250px] [height:151px] [left:14px] [top:17px]",
  "phone-story-lens": "absolute [width:54px] [height:54px]",
  "phone-story-lens-0": "[left:21px] [top:16px]",
  "phone-story-lens-1": "[left:21px] [top:81px]",
  "phone-story-lens-2": "[left:85px] [top:48.5px]",
  "phone-story-lens-ring": "absolute [inset:0] [border-radius:50%]",
  "phone-story-flash": "[width:22px] [height:22px] [right:31px] [top:30px]",
  "phone-story-lidar": "[width:23px] [height:23px] [right:31px] [bottom:30px]",
  "phone-story-camera-mic": "[width:5px] [height:5px] [right:40px] [top:73px] [background:#525c69]",
  "phone-story-hardware": "absolute",
  "phone-story-action-button": "[top:93px] [height:24px]",
  "phone-story-volume-up": "[top:141px] [height:45px]",
  "phone-story-volume-down": "[top:201px] [height:45px]",
  "phone-story-side-button": "[top:162px] [height:63px]",
  "phone-story-camera-control": "[top:391px] [height:41px]",
  "phone-story-antenna": "absolute [width:31.5px] [height:2px] [background:#959da68c]",
  "phone-story-connectors":
    "absolute [top:calc(100%_+_0.1px)] [left:50%] [width:151px] [height:10px] flex items-center justify-between",
  "phone-story-usb": "[border:1px_solid_#87919e]",
  "phone-story-speakers":
    "[width:40px] [height:4px] [background:radial-gradient(circle,_#232a34_1.4px,_#7c8794_1.7px,_transparent_2px)_0_0_/_8px_4px_repeat-x]",
  "phone-story-status":
    "justify-between [height:44px] [padding:0_23px] [font-size:9px] [color:#253448]",
  "phone-story-island": "[left:50%] [z-index:5]",
  "phone-story-appbar":
    "flex [gap:6px] items-center [height:40px] [padding:0_15px] [border-bottom:1px_solid_#edf1f6]",
  "phone-story-screen-panels": "relative [height:455px]",
  "phone-story-screen-panel": "absolute [inset:0] [padding:23px_17px]",
  "phone-story-screen-symbol":
    "grid [place-items:center] [width:44px] [height:44px] [margin-bottom:12px] [border-radius:15px] [color:#3978ef] [background:#edf4ff]",
  "phone-story-bubble": "[width:fit-content] [max-width:96%] [font-size:10px] [line-height:1.7]",
  "phone-story-bubble-me":
    "[margin:12px_0_12px_auto] [padding:10px_12px] [color:#fff] [background:#3478f6] [border-radius:13px_13px_3px_13px]",
  "phone-story-bubble-baro": "flex items-start [gap:7px] [margin:17px_0] [color:#536274]",
  "phone-story-screen-insight":
    "flex items-center [gap:5px] [margin:22px_0_0] [color:#3975d7] [font-size:10px]",
  "phone-story-screen-eyebrow":
    "block [color:#4880dd] [font-size:9px] [font-weight:700] [margin-bottom:12px]",
  "phone-story-screen-file":
    "items-center [gap:9px] [padding:13px_9px] [margin-bottom:8px] [border:1px_solid_#eaf0f9] [background:#f7faff] [border-radius:12px]",
  "phone-story-upload":
    "flex flex-col items-center [gap:5px] [padding:16px_0] [border:1px_dashed_#cadaef] [border-radius:13px]",
  "phone-story-screen-timeline": "list-none [margin:25px_0_0_6px] [border-left:1px_solid_#dce7f6]",
  "phone-story-screen-report": "[background:#f7faff] [border-radius:12px]",
  "phone-story-screen-review":
    "flex [gap:10px] items-center [margin:18px_0] [color:#5486d7] [font-size:10px] [line-height:1.7]",
  "phone-story-screen-cta":
    "flex justify-center [gap:10px] items-center [background:#377aee] [color:#fff] [border-radius:10px] [padding:11px_6px] [font-size:10px] [font-weight:650]",
  "phone-story-home":
    "absolute [bottom:8px] [z-index:5] [left:50%] [width:82px] [height:4px] [border-radius:4px] [background:#172a43]",
  "phone-story-arrival":
    "absolute [inset:43px_0_22px] [z-index:4] [padding:28px_19px_18px] [background:radial-gradient(ellipse_at_100%_0%,_#deebff,_transparent_60%),_linear-gradient(#fff,_#f7faff)]",
  "phone-story-arrival-brand": "flex items-center [gap:10px]",
  "phone-story-arrival-label": "block [margin:17px_0_12px] [font-size:10px] [color:#64748b]",
  "phone-story-arrival-services": "[grid-template-columns:repeat(2,_minmax(0,_1fr))]",
  "phone-story-arrival-prompt":
    "flex items-center justify-between [margin-top:24px] [padding:14px] [border-radius:13px] [color:#fff] [background:#3478f5] [font-size:11px] [font-weight:650]",
  "phone-story-floor":
    "absolute [left:50%] [width:278px] [height:30px] [border-radius:50%] [background:radial-gradient(ellipse,_#33465d50,_#41516b1b_42%,_transparent_72%)]",
  "phone-story-orbit":
    "absolute [top:46%] [left:50%] [border:1px_solid_#cfdef059] [border-radius:50%] pointer-events-none",
  "phone-story-services": "absolute [inset:0] [z-index:3] pointer-events-none",
  "phone-story-service-chip":
    "absolute [top:48%] [left:50%] items-center [border:1px_solid_#ffffffee] [background:linear-gradient(135deg,_#fffffffa,_#f7fafff2)]",
  "phone-story-service-icon":
    "grid [place-items:center] shrink-0 [background:#edf4ff] [color:#3777e6]",
  "phone-story-visual-caption":
    "absolute [left:0] [right:0] text-center [color:#8b9aaf] [letter-spacing:-0.2px]",
  "phone-story-rotation":
    "absolute [right:-4px] [bottom:60px] flex-col items-center [gap:4px] [color:#98accb]",
  "landing-chapter-nav": "[z-index:45] [top:50%] [gap:2px]",
  "everyday-stories": "[color:#191f28]",
  "everyday-heading": "[max-width:1200px] [margin:0_auto_120px]",
  "everyday-eyebrow":
    "[margin:0_0_25px] [color:#2364e8] [font-weight:650] [letter-spacing:-0.025em]",
  "everyday-introduction": "m-0 [color:#657081] [letter-spacing:-0.025em]",
  "everyday-story": "items-center",
  "everyday-photo-stage": "relative min-w-0",
  "everyday-photo-clip": "overflow-hidden isolate",
  "everyday-photo-drift": "absolute",
  "everyday-photo-corner":
    "absolute [z-index:1] [color:#fff] [font-weight:650] [letter-spacing:0.18em]",
  "everyday-story-copy": "relative",
  "everyday-story-label": "flex items-center [gap:13px] [margin:0_0_24px] [font-weight:650]",
  "everyday-story-description": "[margin:0_0_28px] [color:#657081] [letter-spacing:-0.025em]",
  "everyday-takeaway": "flex [align-items:stretch] [gap:16px]",
  "everyday-takeaway-line": "[flex:0_0_3px] [border-radius:3px] [background:#4d82e8]",
  "everyday-link":
    "inline-flex items-center [gap:12px] [min-height:44px] [color:#2364e8] [font-weight:650] [letter-spacing:-0.025em]",
  "everyday-floating-card":
    "absolute [z-index:2] [border:1px_solid_rgb(255_255_255_/_85%)] [background:rgb(255_255_255_/_96%)]",
  "everyday-card-top": "flex items-center [letter-spacing:-0.035em]",
  "everyday-card-icon":
    "grid [place-items:center] [flex:0_0_33px] [border-radius:10px] [background:#ecf3ff] [color:#2364e8]",
  "everyday-mini-timeline": "[gap:12px]",
  "everyday-document-row": "items-center [border-top:1px_solid_#eaf0f6]",
  "everyday-report-title":
    "[margin:0_0_20px] [color:#35445b] [line-height:1.45] [font-weight:700] [letter-spacing:-0.055em]",
  "everyday-report-item":
    "flex items-center [gap:10px] [border-top:1px_solid_#eaf0f6] [font-weight:550]",
  "everyday-report-note":
    "[margin:12px_0_0] [padding:10px_0] [border-radius:8px] [background:#f1f6fd] [color:#526c8e] text-center [font-size:10px]",
  "everyday-disclosure": "m-0 [padding:0_24px] [color:#657081] text-center",
  "time-experience": "relative [color:#fff] [background:#f4f3ef]",
  "time-experience-pin": "isolate overflow-clip",
  "time-introduction": "grid [max-width:1320px] [margin:auto] [color:#293746]",
  "time-eyebrow": "[margin:0_0_22px] [color:#6a6e6c] [font-weight:650] [letter-spacing:0.05em]",
  "time-opening-title": "m-0 [letter-spacing:-0.055em]",
  "time-opening-description": "[margin:24px_0_0] [color:#5e6770] [letter-spacing:-0.025em]",
  "time-opening-chips": "flex flex-wrap [margin:26px_0_0] list-none",
  "time-clock-stage": "grid [place-items:center] min-w-0 [min-height:0] overflow-clip",
  "time-clock": "shrink-0",
  "time-clock-drawing": "block w-full h-full",
  "time-clock-photo": "w-full h-full",
  "time-watch-image": "block w-full h-full [object-fit:cover]",
  "time-blue-wipe": "pointer-events-none",
  "time-message": "[z-index:2]",
  "time-message-inner": "w-full [max-width:1040px] [margin:auto]",
  "time-promise":
    "[margin:20px_0_0] [color:#fff] [font-weight:670] [letter-spacing:-0.045em] [word-break:keep-all]",
  "time-description":
    "[color:#e7efff] [font-weight:420] [letter-spacing:-0.02em] [word-break:keep-all]",
  "time-benefits": "grid p-0 [margin:38px_auto_0] list-none",
  "time-benefit": "items-center",
  "time-benefit-icon": "grid [place-items:center] shrink-0 [border-radius:13px] [color:#fff]",
  "time-action-primary": "[color:#1855c5]",
  "time-action-secondary": "[color:#fff]",
};

export function sceneClasses(value: string) {
  return cn(value, ...value.split(/\s+/).map((name) => sceneUtilities[name]));
}
