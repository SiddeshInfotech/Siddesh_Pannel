'use client';

import { useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LOGIN_SLUG, panelFromSlug, panelPath, type PanelSlug } from './appPanel';

/** Current panel slug from the URL (falls back to the login prefix outside a panel route). */
export function usePanelSlug(): PanelSlug {
  const params = useParams<{ panel?: string }>();
  const slug = params?.panel;
  return panelFromSlug(slug) ? (slug as PanelSlug) : LOGIN_SLUG;
}

/** Returns a function that prefixes in-panel paths with the current panel slug. */
export function usePanelPath(): (path: string) => string {
  const slug = usePanelSlug();
  return useCallback((path: string) => panelPath(slug, path), [slug]);
}

/** next/navigation's router, with push/replace kept inside the current panel's URL prefix. */
export function usePanelRouter() {
  const router = useRouter();
  const toPanel = usePanelPath();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(toPanel(href), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(toPanel(href), options),
  }), [router, toPanel]);
}
