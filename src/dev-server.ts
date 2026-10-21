import { serve } from '@hono/node-server';
import fs from 'node:fs';
import path from 'node:path';
import app from './index';
import { createLocalD1 } from './db/local-d1';

const port = Number(process.env.PORT || 8792);
const db = createLocalD1(':memory:', path.join(process.cwd(), 'schema.sql'));
const staticHtml = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf-8');

console.log(`🚀 Invoice Harness running at http://localhost:${port}`);

serve({
  fetch: (req) =>
    app.fetch(req, {
      DB: db as any,
      STATIC_HTML: staticHtml,
    }),
  port,
});
