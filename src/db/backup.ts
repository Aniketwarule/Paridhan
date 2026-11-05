// ============================================================
// Poshakh – backup & restore
//
// Uses SQLite's own backup API, so the copy is always complete and
// consistent (a plain file copy misses anything still in the WAL file,
// and copying over the open database file corrupts it).
// ============================================================
import * as SQLite from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';
import { getDb, initDb } from './database';
import { localToday } from '../utils/date';

const RESTORE_NAME = 'paridhan-restore.db';
const REQUIRED_TABLES = ['customers', 'orders', 'order_parts', 'blouses', 'settings'];

/** "file:///data/.../cache/" → "/data/.../cache" (expo-sqlite wants a plain path). */
function plainPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
}

function removeIfExists(file: File): void {
  if (file.exists) file.delete();
}

/** Writes a full copy of the database to the cache folder and returns its file URI. */
export function createBackupFile(): string {
  const name = `paridhan-backup-${localToday()}.db`;
  const file = new File(Paths.cache, name);
  removeIfExists(file);
  for (const suffix of ['-wal', '-shm', '-journal']) removeIfExists(new File(Paths.cache, name + suffix));

  const dest = SQLite.openDatabaseSync(name, undefined, plainPath(Paths.cache.uri));
  try {
    SQLite.backupDatabaseSync({ sourceDatabase: getDb(), destDatabase: dest });
    // The live database runs in WAL mode and the backup copies that setting, which
    // can leave data in a side "-wal" file that isn't shared. Switch the copy to a
    // plain journal so everything is inside the one file we send.
    dest.execSync('PRAGMA journal_mode = DELETE;');
  } finally {
    dest.closeSync();
  }
  for (const suffix of ['-wal', '-shm', '-journal']) removeIfExists(new File(Paths.cache, name + suffix));

  const written = new File(Paths.cache, name);
  if (!written.exists || !written.size) throw new Error(`Backup file was not written: ${written.uri}`);
  return written.uri;
}

export class NotABackupError extends Error {}

/**
 * Replaces all data with the backup at `uri` (a file picked by the user).
 * The open database is overwritten in place, so the app keeps running.
 */
export async function restoreBackupFile(uri: string): Promise<void> {
  const tmp = new File(Paths.cache, RESTORE_NAME);
  removeIfExists(tmp);
  new File(uri).copy(tmp);

  let source: SQLite.SQLiteDatabase | null = null;
  try {
    source = SQLite.openDatabaseSync(RESTORE_NAME, undefined, plainPath(Paths.cache.uri));
    let tables: string[];
    try {
      tables = source.getAllSync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`).map(r => r.name);
    } catch {
      throw new NotABackupError();
    }
    if (!REQUIRED_TABLES.every(t => tables.includes(t))) throw new NotABackupError();

    SQLite.backupDatabaseSync({ sourceDatabase: source, destDatabase: getDb() });
  } finally {
    source?.closeSync();
    removeIfExists(tmp);
  }
  // An older backup may need the newer columns.
  await initDb();
}
