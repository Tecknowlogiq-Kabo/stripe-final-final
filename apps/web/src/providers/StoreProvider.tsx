'use client';

import { useRef } from 'react';
import { Provider } from 'react-redux';
import { store } from '@/store';

/**
 * Redux store provider for Client Components.
 * Wrap the app root in layout.tsx so all RTK Query hooks work throughout the tree.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Use ref so we create only one store instance per session, even in StrictMode
  const storeRef = useRef(store);

  return <Provider store={storeRef.current}>{children}</Provider>;
}
