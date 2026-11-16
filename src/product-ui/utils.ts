import { type ClassValue, clsx } from "clsx";
import { useSyncExternalStore } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

/** Preserve optional native props at Headless UI's exact optional boundary. */
export function definedProps<T extends object>(
  props: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

const subscribeClient = () => () => {};
/** Structural Headless widgets are mounted after the matching native SSR frame. */
export function useClientReady() {
  return useSyncExternalStore(
    subscribeClient,
    () => true,
    () => false,
  );
}
