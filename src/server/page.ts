// Expo Hosting sends page URLs to its worker, not to public/'s HTML files, so these routes answer with
// the Exact app's shell (public/shell.html, from scripts/build-web.sh); its client draws the tab from the URL.
const PAGES = ['products', 'stores'];

export async function GET(request: Request) {
  const page = new URL(request.url).pathname.replace(/^\/|\/$/g, '');
  const shell = await fetch(new URL('/shell.html', request.url));
  if (!shell.ok) return new Response('The app page is missing from this deploy.', { status: 500 });
  // Any other path still gets the shell, which draws Exact's not-found screen.
  return new Response(shell.body, { status: page === '' || PAGES.includes(page) ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
