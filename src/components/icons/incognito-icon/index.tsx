import type { SVGProps } from "react";

/** Chrome/Edge-style incognito mark: hat with brim over round glasses. */
export const IncognitoIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true" {...props}>
    <path d="M8.4 3.2h7.2l2 6H6.4z" fill="currentColor" />
    <rect x="2" y="9.4" width="20" height="2" rx="1" fill="currentColor" />
    <circle cx="7" cy="16.5" r="3" stroke="currentColor" strokeWidth="2" />
    <circle cx="17" cy="16.5" r="3" stroke="currentColor" strokeWidth="2" />
    <path d="M10 16c1.3-.9 2.7-.9 4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
