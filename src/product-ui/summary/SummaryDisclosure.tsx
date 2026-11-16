import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../Button";
import { useClientReady } from "../utils";

export function SummaryDisclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  const ready = useClientReady();
  if (!ready)
    return (
      <div data-product-summary-disclosure="">
        <Button
          variant="ghost"
          disabled
          className="w-full justify-between px-0 text-left"
          aria-expanded={false}
        >
          {title}
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
        <div hidden>{children}</div>
      </div>
    );
  return (
    <Disclosure as="div" data-product-summary-disclosure="">
      {({ open }) => (
        <>
          <DisclosureButton
            as={Button}
            variant="ghost"
            className="w-full justify-between px-0 text-left text-sm"
          >
            {title}
            <ChevronDown
              size={16}
              className={open ? "shrink-0 rotate-180" : "shrink-0"}
              aria-hidden="true"
            />
          </DisclosureButton>
          <DisclosurePanel
            static
            hidden={!open}
            className="space-y-3 pb-3 pt-2 text-sm leading-6 text-[var(--pui-muted)]"
          >
            {children}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
}
