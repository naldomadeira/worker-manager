import { useMediaQuery } from './useMediaQuery';

/** Below the `md` breakpoint (768px), the same threshold the shadcn sidebar collapses at. */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export function useMobileQuery() {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}
