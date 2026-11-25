import { useEffect } from 'react';
import { site } from './site';

/** Sets the tab title for a route; the home page uses the bare site name. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} | ${site.name}` : `${site.name} | AI for the systems you already run`;
  }, [title]);
}
