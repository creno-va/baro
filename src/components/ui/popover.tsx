import { Popover as HeadlessPopover } from "@headlessui/react";
import type { ComponentProps } from "react";
import { useClientReady } from "./utils";
export function Popover(props: ComponentProps<typeof HeadlessPopover>) {
  const ready = useClientReady();
  return ready ? <HeadlessPopover {...props} /> : null;
}
export { PopoverButton, PopoverPanel } from "@headlessui/react";
