// Production answers on one host; the Worker redirects the others it's routed for.

/** www.concursero.com/x and munninlabs.com/concursero-angular/x → https://concursero.com/x */
export function redirectToCanonical(url: URL, canonical: string | undefined): string | null {
  if (!canonical || url.hostname === canonical) return null;
  const path = url.pathname.replace(/^\/concursero-angular(?=\/|$)/, '') || '/';
  return `https://${canonical}${path}${url.search}`;
}
