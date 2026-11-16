import { z } from "zod";
import { createStore } from "zustand/vanilla";

export const productPanelSchema = z.enum(["conversation", "materials", "report"]);
export const productThemeSchema = z.enum(["system", "light", "dark"]);
export const productUIStateSchema = z.strictObject({
  sidebarCollapsed: z.boolean(),
  mobileNavigationOpen: z.boolean(),
  activePanel: productPanelSchema,
  theme: productThemeSchema,
});
export const productUIInitialStateSchema = productUIStateSchema.partial();
/** Preferences seed the view; this store never reads or writes browser storage. */
export const productUIPreferencesSchema = z.strictObject({
  sidebarCollapsed: z.boolean().optional(),
  theme: productThemeSchema.optional(),
});

export type ProductPanel = z.infer<typeof productPanelSchema>;
export type ProductTheme = z.infer<typeof productThemeSchema>;
export type ProductUIData = z.infer<typeof productUIStateSchema>;
export type ProductUIInitialState = z.input<typeof productUIInitialStateSchema>;
export type ProductUIPreferences = z.input<typeof productUIPreferencesSchema>;
export type ProductUIState = ProductUIData & {
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavigationOpen: (open: boolean) => void;
  setActivePanel: (panel: ProductPanel) => void;
  setTheme: (theme: ProductTheme) => void;
  reset: () => void;
};

const defaults: Readonly<ProductUIData> = Object.freeze({
  sidebarCollapsed: false,
  mobileNavigationOpen: false,
  activePanel: "conversation",
  theme: "system",
});

const defined = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

/** A fresh store belongs to one application island or server render.
 * Server data, identities and authentication never belong in this UI store. */
export function createProductUIStore(initialState: unknown = {}, preferences: unknown = {}) {
  const initial = productUIStateSchema.parse({
    ...defaults,
    ...defined(productUIPreferencesSchema.parse(preferences)),
    ...defined(productUIInitialStateSchema.parse(initialState)),
  });
  return createStore<ProductUIState>()((set) => ({
    ...initial,
    setSidebarCollapsed: (value) => set({ sidebarCollapsed: z.boolean().parse(value) }),
    setMobileNavigationOpen: (value) => set({ mobileNavigationOpen: z.boolean().parse(value) }),
    setActivePanel: (value) => set({ activePanel: productPanelSchema.parse(value) }),
    setTheme: (value) => set({ theme: productThemeSchema.parse(value) }),
    reset: () => set({ ...initial }),
  }));
}

export type ProductUIStore = ReturnType<typeof createProductUIStore>;
