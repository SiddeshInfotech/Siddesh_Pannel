'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { usePanelPath } from '@/lib/usePanelPath';

/**
 * next/link that keeps the user inside their panel's URL prefix: an in-app href like '/keys'
 * becomes '/lab-admin/keys' for a Lab-Admin session. External and non-root hrefs are untouched.
 */
export default function PanelLink({ href, ...props }: ComponentProps<typeof Link>) {
  const toPanel = usePanelPath();
  const target = typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? toPanel(href) : href;
  return <Link href={target} {...props} />;
}
