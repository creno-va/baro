import { TabGroup as HeadlessTabGroup, Tab, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { cn, useClientReady } from "./utils";
export function TabGroup(props: ComponentProps<typeof HeadlessTabGroup>) {
  const ready = useClientReady();
  return ready ? <HeadlessTabGroup {...props} /> : null;
}
export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
export function Tabs({
  items,
  label,
  defaultValue,
  className,
}: {
  items: TabItem[];
  label: string;
  defaultValue?: string;
  className?: string;
}) {
  const [requested, setSelected] = useState(defaultValue);
  const selected = Math.max(
    0,
    items.findIndex((item) => item.value === requested && !item.disabled),
  );
  return (
    <TabGroup
      manual
      selectedIndex={
        items[selected]?.disabled ? items.findIndex((item) => !item.disabled) : selected
      }
      onChange={(index) => setSelected(items[index]?.value)}
      className={cn("ui-tabs", className)}
      data-slot="tabs"
    >
      <TabList className="ui-tabs__list" aria-label={label}>
        {items.map((item) => (
          <Tab key={item.value} disabled={Boolean(item.disabled)}>
            {item.label}
          </Tab>
        ))}
      </TabList>
      <TabPanels>
        {items.map((item) => (
          <TabPanel key={item.value} className="ui-tabs__panel" unmount={false}>
            {item.content}
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  );
}

export { Tab, TabList, TabPanel, TabPanels };
