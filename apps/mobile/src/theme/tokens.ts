import { designTokens } from "@baro/design-tokens";

// Press feedback changes the surface, never the opacity of readable labels.
function darken(hex: string) {
  return `#${[1, 3, 5]
    .map((start) =>
      Math.round(Number.parseInt(hex.slice(start, start + 2), 16) * 0.88)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** Web owns portable meaning; native owns density, typography and OS control sizes. */
export const tokens = {
  color: {
    ...designTokens.color,
    background: designTokens.color.subtle,
    controlBorder: designTokens.color.muted,
    primaryPressed: darken(designTokens.color.primary),
  },
  space: { small: 8, control: 12, section: 24, page: 20, card: 20 },
  radius: { control: 12, card: designTokens.radius.card },
  control: { minimumSize: Math.max(48, designTokens.control.minimumSize) },
  type: {
    body: { fontSize: 16, lineHeight: 26 },
    title: { fontSize: 28, lineHeight: 38 },
    heading: { fontSize: 20, lineHeight: 30 },
  },
} as const;

export const nativePagePadding = (width: number) =>
  width < 360 ? 16 : width >= 600 ? 32 : tokens.space.page;
