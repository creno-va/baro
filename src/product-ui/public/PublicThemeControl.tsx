import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  setTheme,
  subscribeTheme,
  type ThemePreference,
  themePreference,
} from "../../client/theme";
import { Button } from "../Button";
import { GlobalProductTheme } from "../GlobalTheme";
import { useProductTheme } from "../Theme";

const choices: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "라이트 모드", icon: Sun },
  { value: "dark", label: "다크 모드", icon: Moon },
  { value: "system", label: "시스템 설정", icon: Monitor },
];
export function PublicThemeControl() {
  const preference = useSyncExternalStore(subscribeTheme, themePreference, () => "system" as const);
  return (
    <GlobalProductTheme className="contents">
      <ThemeMenu preference={preference} />
    </GlobalProductTheme>
  );
}
function ThemeMenu({ preference }: { preference: ThemePreference }) {
  const theme = useProductTheme();
  const Icon = choices.find((item) => item.value === preference)?.icon ?? Monitor;
  return (
    <Menu>
      <MenuButton as={Button} variant="ghost" size="icon" aria-label="화면 테마 변경">
        <Icon size={18} aria-hidden="true" />
      </MenuButton>
      <MenuItems
        anchor={{ to: "bottom end", gap: 8, padding: 12 }}
        portal
        data-product-ui=""
        data-theme={theme}
        className="z-[90] min-w-44 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-1 text-[var(--pui-text)] shadow-lg focus:outline-none"
      >
        {choices.map((choice) => (
          <MenuItem key={choice.value}>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start rounded-lg data-focus:bg-[var(--pui-background)]"
              aria-current={preference === choice.value ? "true" : undefined}
              onClick={() => setTheme(choice.value)}
            >
              <choice.icon size={16} aria-hidden="true" />
              <span className="flex-1 text-left">{choice.label}</span>
              {preference === choice.value && <Check size={16} aria-hidden="true" />}
            </Button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}
