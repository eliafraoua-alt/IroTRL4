import path from 'path';
import { initDB, IroDatabase } from '../src/database';

const dbPath = path.join(process.cwd(), 'data', 'iro_vault.db');

let _dbInstance: IroDatabase | null = null;
let _dbPromise: Promise<IroDatabase> | null = null;

export function getDbInstance(): IroDatabase {
  if (!_dbInstance) {
    throw new Error('Database not initialized yet.');
  }
  return _dbInstance;
}

export async function ensureDbInitialized(): Promise<IroDatabase> {
  if (!_dbPromise) {
    _dbPromise = initDB(dbPath).then(instance => {
      _dbInstance = instance;
      return instance;
    });
  }
  return _dbPromise;
}

// Proxied synchronous db object that delegates to _dbInstance once ready
export const db = {
  exec(sql: string): void {
    if (!_dbInstance) throw new Error('Database not initialized yet. Call ensureDbInitialized() first.');
    _dbInstance.exec(sql);
  },
  prepare(sql: string) {
    return {
      run: (...params: any[]) => {
        if (!_dbInstance) throw new Error('Database not initialized yet. Call ensureDbInitialized() first.');
        return _dbInstance.prepare(sql).run(...params);
      },
      get: <T = any>(...params: any[]): T | undefined => {
        if (!_dbInstance) throw new Error('Database not initialized yet. Call ensureDbInitialized() first.');
        return _dbInstance.prepare(sql).get(...params);
      },
      all: <T = any>(...params: any[]): T[] => {
        if (!_dbInstance) throw new Error('Database not initialized yet. Call ensureDbInitialized() first.');
        return _dbInstance.prepare(sql).all(...params);
      }
    };
  },
  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      if (!_dbInstance) throw new Error('Database not initialized yet. Call ensureDbInitialized() first.');
      return _dbInstance.transaction(fn)(...args);
    }) as unknown as T;
  },
  close(): void {
    if (_dbInstance) _dbInstance.close();
  }
} as any;
