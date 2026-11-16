import { type ClassValue, clsx } from "clsx";
import { useSyncExternalStore } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
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
