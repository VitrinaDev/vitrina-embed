/**
 * The two ways the widget sends a visitor to a page (0.23.5, «Ver productos»
 * with a catalog URL): the same tab, or a new one. An object rather than bare
 * calls so a test can stand in for the browser, which happy-dom cannot do.
 */
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  openTab(url: string): void {
    window.open(url, '_blank', 'noopener');
  },
};

/**
 * Go to `url` from a widget on the current page. Same origin as the host page
 * means the visitor is already on that site: navigate this tab (after `close`,
 * so the panel is not left open over the page they asked for), and only close
 * when they are already on that exact page. Any other origin opens a new tab,
 * so the visitor does not lose the page they were on.
 */
export function goToPage(url: string, close: () => void): void {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return;
  }
  const here = window.location;
  if (target.origin !== here.origin) {
    navigation.openTab(target.href);
    return;
  }
  close();
  const sansHash = (href: string): string => href.split('#')[0] ?? href;
  if (sansHash(target.href) === sansHash(here.href)) return;
  navigation.assign(target.href);
}
