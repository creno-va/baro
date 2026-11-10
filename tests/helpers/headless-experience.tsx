import { createRoot } from "react-dom/client";
import { Experience } from "../../src/components/ui/experience";
import "../../src/styles/design-system.css";

if (typeof document !== "undefined" && !document.querySelector("[data-baro-experience]")) {
  document.documentElement.setAttribute("data-baro-ui", "");
  document.documentElement.dataset.theme ??= "light";
  const host = document.createElement("div");
  host.setAttribute("data-baro-experience", "");
  document.body.append(host);
  createRoot(host).render(<Experience />);
}
