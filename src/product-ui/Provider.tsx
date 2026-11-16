import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { useStore } from "zustand";
import { createProductQueryClient } from "./queries";
import {
  createProductUIStore,
  type ProductUIInitialState,
  type ProductUIPreferences,
  type ProductUIState,
  type ProductUIStore,
} from "./state";

const ProductUIContext = createContext<ProductUIStore | null>(null);

/** Initial props are an SSR-safe seed. Subsequent interactions use store actions. */
export function ProductUIProvider({
  children,
  initialState,
  preferences,
}: {
  children: ReactNode;
  initialState?: ProductUIInitialState;
  preferences?: ProductUIPreferences;
}) {
  const [{ store, queryClient }] = useState(() => ({
    store: createProductUIStore(initialState, preferences),
    queryClient: createProductQueryClient(),
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <ProductUIContext.Provider value={store}>{children}</ProductUIContext.Provider>
    </QueryClientProvider>
  );
}

export function useProductUI<T>(selector: (state: ProductUIState) => T): T {
  const store = useContext(ProductUIContext);
  if (!store) throw new Error("ProductUIProvider is required");
  return useStore(store, selector);
}
