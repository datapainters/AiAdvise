/**
 * Site-wide settings that are content, not code.
 *
 * `contactEmail` drives the "Book an introduction" buttons. While it is empty
 * the site shows no contact button at all rather than a dead link, so set it
 * before sending anyone to the marketing pages.
 */
export const site = {
  name: 'Advisory',
  tagline: 'Independent advice on fitting AI into systems that already work.',
  contactEmail: '',
} as const;

export function contactHref(): string | null {
  if (!site.contactEmail) return null;
  const subject = encodeURIComponent('Introduction');
  return `mailto:${site.contactEmail}?subject=${subject}`;
}
