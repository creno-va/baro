import { Button as HeadlessButton, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  setTheme,
  subscribeTheme,
  type ThemePreference,
  themePreference,
} from "../../client/theme";

const choices: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "라이트 모드", icon: Sun },
  { value: "dark", label: "다크 모드", icon: Moon },
  { value: "system", label: "시스템 설정", icon: Monitor },
];
export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribeTheme, themePreference, () => "system" as const);
  const Icon = choices.find((item) => item.value === preference)?.icon ?? Monitor;
  return (
    <Menu>
      <MenuButton className="ui-control ui-theme-toggle" aria-label="화면 테마 변경">
        <Icon size={18} aria-hidden="true" />
      </MenuButton>
      <MenuItems anchor={{ to: "bottom end", gap: 8, padding: 12 }} portal className="ui-menu">
        {choices.map((choice) => (
          <MenuItem key={choice.value}>
            <HeadlessButton
              type="button"
              className="ui-menu__item"
              aria-current={preference === choice.value ? "true" : undefined}
              onClick={() => setTheme(choice.value)}
            >
              <choice.icon size={16} aria-hidden="true" />
              <span>{choice.label}</span>
              {preference === choice.value && <Check size={16} aria-hidden="true" />}
            </HeadlessButton>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
