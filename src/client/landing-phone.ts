/** A scroll-driven, full 360° device turn, with a compact touch layout and static reduced motion. */
const phoneStory = document.querySelector<HTMLElement>("[data-phone-story]");

if (phoneStory) {
  const scene = phoneStory;
  const motionViewport = window.matchMedia(
    "(min-width: 768px) and (min-height: 600px), (min-width: 320px) and (max-width: 767px) and (min-height: 520px)",
  );
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const chapters = [...scene.querySelectorAll<HTMLElement>("[data-phone-chapter]")];
  const screens = [...scene.querySelectorAll<HTMLElement>("[data-phone-screen]")];
  const services = [...scene.querySelectorAll<HTMLElement>("[data-phone-service]")];
  const facets = [...scene.querySelectorAll<HTMLElement>("[data-phone-facet]")];
  const buttons = [...scene.querySelectorAll<HTMLButtonElement>("[data-phone-step]")];
  const serviceOrigins: [number, number][] = [
    [-172, -181],
    [174, -78],
    [-172, 77],
    [174, 186],
  ];
  const metalSurfaces: { node: HTMLElement; x: number; y: number; back: boolean }[] = [];
  let enabled = false;
  let frame = 0;
  let chapter = -1;

  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const smoothstep = (value: number) => {
    const bounded = clamp(value);
    return bounded * bounded * (3 - 2 * bounded);
  };

  function placeFacet(
    facet: HTMLElement,
    angle: number,
    x: number,
    y: number,
    length: number,
    depth: number,
    centerZ: number,
    back: boolean,
  ) {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    metalSurfaces.push({ node: facet, x: nx, y: ny, back });
    facet.style.width = `${length + 0.25}px`;
    facet.style.height = `${depth}px`;
    facet.style.marginLeft = `${-(length + 0.25) / 2}px`;
    facet.style.marginTop = `${-depth / 2}px`;
    // Tangent, depth and outward normal form the three basis vectors of each wall.
    facet.style.transform = `matrix3d(${-ny},${nx},0,0,0,0,1,0,${nx},${ny},0,0,${x},${y},${centerZ},1)`;
  }

  function buildRoundedShell(
    nodes: HTMLElement[],
    width: number,
    height: number,
    radius: number,
    depth: number,
    centerZ: number,
    back: boolean,
  ) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const cornerSegments = 12;
    const halfSegment = Math.PI / (4 * cornerSegments);

    for (const [index, facet] of nodes.entries()) {
      let angle: number;
      let x: number;
      let y: number;
      let length: number;
      if (index < 4) {
        angle = (index * Math.PI) / 2;
        x = Math.cos(angle) * halfWidth;
        y = Math.sin(angle) * halfHeight;
        length = (index % 2 === 0 ? halfHeight : halfWidth) * 2 - radius * 2;
      } else {
        const corner = Math.floor((index - 4) / cornerSegments);
        const step = (index - 4) % cornerSegments;
        angle = (corner * Math.PI) / 2 + (step + 0.5) * halfSegment * 2;
        const centerX = (corner === 0 || corner === 3 ? 1 : -1) * (halfWidth - radius);
        const centerY = (corner < 2 ? 1 : -1) * (halfHeight - radius);
        // Each facet is a chord. Adjacent endpoints meet the caps and the straight walls.
        const chordRadius = radius * Math.cos(halfSegment);
        x = centerX + chordRadius * Math.cos(angle);
        y = centerY + chordRadius * Math.sin(angle);
        length = 2 * radius * Math.sin(halfSegment);
      }
      placeFacet(facet, angle, x, y, length, depth, centerZ, back);
    }
  }

  function buildShell() {
    buildRoundedShell(facets, 280, 586.56, 46, 31.41, 0, false);
    const cameraWalls = [...scene.querySelectorAll<HTMLElement>("[data-phone-camera-wall]")];
    buildRoundedShell(cameraWalls, 250, 151, 31, 4.8, 2.4, true);
    const lensWalls = [...scene.querySelectorAll<HTMLElement>("[data-phone-lens-wall]")];
    const halfSegment = Math.PI / 24;
    for (const wall of lensWalls) {
      const index = Number(wall.dataset.phoneLensWall);
      const angle = (index + 0.5) * halfSegment * 2;
      const radius = 27 * Math.cos(halfSegment);
      placeFacet(
        wall,
        angle,
        radius * Math.cos(angle),
        radius * Math.sin(angle),
        54 * Math.sin(halfSegment),
        6.4,
        8,
        true,
      );
    }
  }

  function selectChapter(next: number) {
    if (chapter === next) return;
    chapter = next;
    scene.dataset.chapter = String(next);
    for (const [index, node] of chapters.entries()) node.hidden = enabled && index !== next;
    for (const [index, node] of screens.entries())
      node.classList.toggle("is-current", index === next);
    for (const [index, button] of buttons.entries()) {
      button.setAttribute("aria-pressed", String(index === next));
    }
  }

  function render() {
    frame = 0;
    if (!enabled) return;
    const bounds = scene.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
    const visual = scene.querySelector<HTMLElement>(".phone-story-visual");
    if (visual) {
      if (window.innerWidth < 768) {
        visual.style.setProperty(
          "--phone-scale",
          Math.min(0.58, (visual.clientHeight - 24) / 586.56).toFixed(3),
        );
        visual.style.setProperty(
          "--phone-chip-span",
          Math.min(0.6, (visual.clientWidth - 116) / 348).toFixed(3),
        );
      } else {
        visual.style.removeProperty("--phone-scale");
        visual.style.removeProperty("--phone-chip-span");
      }
    }
    const pin = scene.querySelector<HTMLElement>(".phone-story-sticky");
    const stickyTop = pin ? Number.parseFloat(window.getComputedStyle(pin).top) || 0 : 0;
    const distance = Math.max(1, scene.offsetHeight - (pin?.offsetHeight || window.innerHeight));
    const progress = clamp((stickyTop - bounds.top) / distance);
    const turnProgress = smoothstep(progress / 0.48);
    const turn = -18 - turnProgress * 360;
    scene.style.setProperty("--phone-progress", progress.toFixed(4));
    // Finish the complete turn before the services settle into the front-facing BARO app.
    scene.style.setProperty("--phone-turn", `${turn.toFixed(2)}deg`);
    scene.style.setProperty(
      "--phone-tilt",
      `${(5 - Math.sin(turnProgress * Math.PI * 2) * 7).toFixed(2)}deg`,
    );
    scene.style.setProperty("--phone-rise", `${(-Math.sin(progress * Math.PI) * 19).toFixed(2)}px`);
    scene.style.setProperty(
      "--phone-reflection",
      `${(24 + Math.sin(turnProgress * Math.PI) * 46).toFixed(2)}%`,
    );
    const turnRadians = (turn * Math.PI) / 180;
    scene.style.setProperty(
      "--phone-shadow-width",
      (0.34 + Math.abs(Math.cos(turnRadians)) * 0.66).toFixed(3),
    );
    for (const surface of metalSurfaces) {
      const angle = turnRadians + (surface.back ? Math.PI : 0);
      const light =
        surface.x * Math.cos(angle) * -0.3 - surface.y * 0.45 - surface.x * Math.sin(angle) * 0.55;
      surface.node.style.setProperty("--phone-metal-shade", (0.12 - light * 0.12).toFixed(3));
    }

    let absorbed = 0;
    let intakeGlow = 0;
    for (const [index, service] of services.entries()) {
      const origin = serviceOrigins[index];
      if (!origin) continue;
      const intake = clamp((progress - (0.42 + index * 0.12)) / 0.105);
      const travel = smoothstep(intake);
      const drift = Math.sin(progress * Math.PI * 2 + index) * 9 * (1 - travel);
      const verticalFit =
        window.innerWidth < 768
          ? Math.min(0.52, Math.max(0.3, ((visual?.clientHeight ?? 270) - 76) / 372))
          : 1;
      service.style.setProperty("--phone-service-x", `${(origin[0] * (1 - travel)).toFixed(2)}px`);
      service.style.setProperty(
        "--phone-service-y",
        `${(origin[1] * verticalFit * (1 - travel) - travel * 28 + drift).toFixed(2)}px`,
      );
      service.style.setProperty("--phone-service-scale", (1 - travel * 0.86).toFixed(3));
      service.style.setProperty(
        "--phone-service-opacity",
        (1 - smoothstep((intake - 0.64) / 0.36)).toFixed(3),
      );
      service.style.setProperty(
        "--phone-service-turn",
        `${((index % 2 === 0 ? -5 : 5) * (1 - travel)).toFixed(2)}deg`,
      );
      if (intake === 1) absorbed++;
      intakeGlow = Math.max(intakeGlow, Math.sin(intake * Math.PI));
    }
    scene.dataset.phoneAbsorbed = String(absorbed);
    scene.style.setProperty("--phone-intake-glow", intakeGlow.toFixed(3));
    scene.style.setProperty("--phone-app-arrival", smoothstep((progress - 0.9) / 0.085).toFixed(3));
    // The visible explanation and app screen follow the service currently entering the phone.
    selectChapter(progress < 0.54 ? 0 : progress < 0.66 ? 1 : progress < 0.78 ? 2 : 3);
  }

  function schedule() {
    if (enabled && !frame) frame = window.requestAnimationFrame(render);
  }

  function configure() {
    enabled = motionViewport.matches && !reduceMotion.matches;
    scene.classList.toggle("phone-story-ready", enabled);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    chapter = -1;
    selectChapter(0);
    if (enabled) schedule();
    else {
      for (const node of chapters) node.hidden = false;
      scene.style.removeProperty("--phone-turn");
      scene.style.removeProperty("--phone-tilt");
      scene.style.removeProperty("--phone-rise");
      scene.style.removeProperty("--phone-app-arrival");
      scene.style.removeProperty("--phone-intake-glow");
    }
  }

  function goToChapter(index: number) {
    if (!enabled) return;
    const pin = scene.querySelector<HTMLElement>(".phone-story-sticky");
    const stickyTop = pin ? Number.parseFloat(window.getComputedStyle(pin).top) || 0 : 0;
    const distance = Math.max(1, scene.offsetHeight - (pin?.offsetHeight || window.innerHeight));
    // Keep selected chapters clear of boundaries, including floating-point rounding on restore.
    const progress = index === 0 ? 0 : 0.54 + (index - 1) * 0.12 + 0.045;
    const top =
      window.scrollY + scene.getBoundingClientRect().top - stickyTop + distance * progress;
    window.scrollTo({ top, behavior: "smooth" });
  }

  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => goToChapter(index));
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[next]?.focus({ preventScroll: true });
      goToChapter(next);
    });
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("pageshow", configure);
  motionViewport.addEventListener("change", configure);
  reduceMotion.addEventListener("change", configure);
  buildShell();
  configure();
}

export {};
