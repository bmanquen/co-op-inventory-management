import { handle } from '@/server/api';
import { db, ready } from '@/server/db';

// The Exact app's API (src/server/api.ts) at /api/*, on this environment's Turso database.
async function serve(request: Request) {
  const code = process.env.TEAM_CODE;
  if (!code) throw new Error('TEAM_CODE is not set on the server');
  await ready();
  return handle(request, db(), code);
}

export { serve as GET, serve as POST, serve as DELETE, serve as OPTIONS };
