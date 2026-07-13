import { createServer }  from 'http';
import express           from 'express';
import apiRouter         from '../../server/routes/index';
import path              from 'path';
import os               from 'os';
import fs               from 'fs';

let server: ReturnType<typeof createServer>;
let baseUrl: string;
let testDbPath: string;  // CORRECTION : base SQLite éphémère par run

export async function startTestServer(): Promise<string> {
  // CORRECTION DB-ISOLATION : base SQLite temporaire dans /tmp
  // Évite toute pollution de data/iro_vault.db en développement local
  // et garantit des tests déterministes en CI (machine vierge).
  testDbPath = path.join(os.tmpdir(), `iro-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.DB_PATH        = testDbPath;
  process.env.NODE_ENV       = 'test';
  process.env.GEMINI_API_KEY = 'test-key-integration';

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);

  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (server) {
      server.close((err?: Error) => err ? reject(err) : resolve());
    } else {
      resolve();
    }
  });
  // Nettoyage de la base temporaire
  if (testDbPath && fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch { /* best-effort */ }
  }
}

export { baseUrl };
