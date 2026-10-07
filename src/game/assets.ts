/** Resolve files from /public correctly on Vite sites deployed under a sub-path (e.g. GitHub Pages). */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${clean}`;
}
