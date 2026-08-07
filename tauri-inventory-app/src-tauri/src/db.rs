use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Local SQLite cache for offline v1: cached catalog/stock + an outbox of
/// queued stock adjustments waiting to be pushed to the server. Schema is
/// intentionally small — this mirrors only what offline stock adjustments
/// need, not the full ~70-table backend schema (see
/// App\Application\Services\DesktopSyncService on the backend for the
/// matching bootstrap/delta/push contract).
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("phyzioline_offline.sqlite"))
}

pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS cached_skus (
            id INTEGER PRIMARY KEY,
            sku TEXT,
            name TEXT,
            barcode TEXT,
            cost_price REAL,
            selling_price REAL,
            is_active INTEGER,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS cached_locations (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            is_active INTEGER,
            updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS cached_stock (
            sku_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            quantity REAL NOT NULL DEFAULT 0,
            updated_at TEXT,
            PRIMARY KEY (sku_id, location_id)
        );

        CREATE TABLE IF NOT EXISTS outbox_operations (
            client_op_id TEXT PRIMARY KEY,
            sku_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL,
            op_type TEXT NOT NULL,
            quantity REAL NOT NULL,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn get_state(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM sync_state WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set_state(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
