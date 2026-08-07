use crate::db;
use reqwest::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;

const API_BASE: &str = "https://inventory.phyzioline.com";
const ADDITION_TYPES: [&str; 3] = ["CORRECTION", "OPENING_BALANCE", "STOCK_IN"];

pub struct SyncState {
    pub conn: Mutex<Connection>,
    pub http: Client,
}

pub fn init_state(app: &AppHandle) -> Result<SyncState, String> {
    Ok(SyncState {
        conn: Mutex::new(db::open(app)?),
        http: Client::new(),
    })
}

#[derive(Serialize)]
pub struct SyncStatus {
    pending_count: i64,
    last_synced_at: Option<String>,
    device_id: Option<String>,
}

#[tauri::command]
pub fn store_desktop_token(
    state: State<SyncState>,
    token: String,
    device_id: String,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    db::set_state(&conn, "auth_token", &token)?;
    db::set_state(&conn, "device_id", &device_id)?;
    Ok(())
}

#[tauri::command]
pub fn clear_desktop_token(state: State<SyncState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM sync_state WHERE key IN ('auth_token','device_id')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_sync_status(state: State<SyncState>) -> Result<SyncStatus, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let pending_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM outbox_operations WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(SyncStatus {
        pending_count,
        last_synced_at: db::get_state(&conn, "last_synced_at"),
        device_id: db::get_state(&conn, "device_id"),
    })
}

#[derive(Serialize)]
pub struct CachedStockRow {
    sku_id: i64,
    sku: Option<String>,
    name: Option<String>,
    barcode: Option<String>,
    location_id: i64,
    location_name: Option<String>,
    quantity: f64,
}

#[tauri::command]
pub fn list_cached_stock(
    state: State<SyncState>,
    location_id: Option<i64>,
) -> Result<Vec<CachedStockRow>, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT cs.sku_id, sk.sku, sk.name, sk.barcode, cs.location_id, loc.name, cs.quantity
             FROM cached_stock cs
             LEFT JOIN cached_skus sk ON sk.id = cs.sku_id
             LEFT JOIN cached_locations loc ON loc.id = cs.location_id
             WHERE (?1 IS NULL OR cs.location_id = ?1)
             ORDER BY sk.name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![location_id], |row| {
            Ok(CachedStockRow {
                sku_id: row.get(0)?,
                sku: row.get(1)?,
                name: row.get(2)?,
                barcode: row.get(3)?,
                location_id: row.get(4)?,
                location_name: row.get(5)?,
                quantity: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct AdjustmentInput {
    sku_id: i64,
    location_id: i64,
    #[serde(rename = "type")]
    op_type: String,
    quantity: f64,
    notes: Option<String>,
}

/// Queues a stock adjustment locally (outbox) and optimistically updates the
/// cached stock quantity. The queued operation is applied server-side (via
/// the same FIFO-costing InventoryAdjustmentService the online adjustments
/// screen uses) the next time sync_now() succeeds.
#[tauri::command]
pub fn record_offline_adjustment(
    state: State<SyncState>,
    input: AdjustmentInput,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let client_op_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO outbox_operations (client_op_id, sku_id, location_id, op_type, quantity, notes, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        params![client_op_id, input.sku_id, input.location_id, input.op_type, input.quantity, input.notes, now],
    )
    .map_err(|e| e.to_string())?;

    let is_addition = ADDITION_TYPES.contains(&input.op_type.as_str());
    let delta = if is_addition { input.quantity } else { -input.quantity };

    conn.execute(
        "INSERT INTO cached_stock (sku_id, location_id, quantity, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(sku_id, location_id) DO UPDATE SET quantity = quantity + ?3, updated_at = ?4",
        params![input.sku_id, input.location_id, delta, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(client_op_id)
}

#[derive(Deserialize)]
struct SnapshotResponse {
    cursor: String,
    skus: Vec<serde_json::Value>,
    locations: Vec<serde_json::Value>,
    stock: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct PushResultItem {
    client_op_id: String,
    status: String,
    message: Option<String>,
}

#[derive(Deserialize)]
struct PushResponse {
    results: Vec<PushResultItem>,
}

#[derive(Serialize)]
pub struct SyncSummary {
    pulled: bool,
    pushed: usize,
    applied: usize,
    failed: usize,
}

/// Pulls the latest catalog/stock snapshot (bootstrap on first run, delta
/// after) and pushes any queued outbox operations. Call this on startup,
/// when connectivity returns, and periodically while online.
#[tauri::command]
pub async fn sync_now(state: State<'_, SyncState>) -> Result<SyncSummary, String> {
    let (token, device_id, cursor) = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let token = db::get_state(&conn, "auth_token").ok_or("not logged in")?;
        let device_id =
            db::get_state(&conn, "device_id").unwrap_or_else(|| "unknown-device".to_string());
        let cursor = db::get_state(&conn, "last_synced_at");
        (token, device_id, cursor)
    };

    let pulled = pull(&state, &token, cursor).await?;
    let (pushed, applied, failed) = push_outbox(&state, &token, &device_id).await?;

    Ok(SyncSummary {
        pulled,
        pushed,
        applied,
        failed,
    })
}

async fn pull(
    state: &State<'_, SyncState>,
    token: &str,
    cursor: Option<String>,
) -> Result<bool, String> {
    let url = match &cursor {
        Some(since) => format!("{API_BASE}/api/v1/inventory/desktop/sync/delta?since={since}"),
        None => format!("{API_BASE}/api/v1/inventory/desktop/sync/bootstrap"),
    };

    let resp = state
        .http
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<SnapshotResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let conn = state.conn.lock().map_err(|e| e.to_string())?;

    for sku in &resp.skus {
        conn.execute(
            "INSERT INTO cached_skus (id, sku, name, barcode, cost_price, selling_price, is_active, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET sku=excluded.sku, name=excluded.name, barcode=excluded.barcode,
                cost_price=excluded.cost_price, selling_price=excluded.selling_price,
                is_active=excluded.is_active, updated_at=excluded.updated_at",
            params![
                sku.get("id").and_then(|v| v.as_i64()),
                sku.get("sku").and_then(|v| v.as_str()),
                sku.get("name").and_then(|v| v.as_str()),
                sku.get("barcode").and_then(|v| v.as_str()),
                sku.get("cost_price").and_then(|v| v.as_f64()),
                sku.get("selling_price").and_then(|v| v.as_f64()),
                sku.get("is_active").and_then(|v| v.as_bool()).map(|b| b as i64),
                sku.get("updated_at").and_then(|v| v.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for loc in &resp.locations {
        conn.execute(
            "INSERT INTO cached_locations (id, name, type, is_active, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type,
                is_active=excluded.is_active, updated_at=excluded.updated_at",
            params![
                loc.get("id").and_then(|v| v.as_i64()),
                loc.get("name").and_then(|v| v.as_str()),
                loc.get("type").and_then(|v| v.as_str()),
                loc.get("is_active").and_then(|v| v.as_bool()).map(|b| b as i64),
                loc.get("updated_at").and_then(|v| v.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for stock in &resp.stock {
        conn.execute(
            "INSERT INTO cached_stock (sku_id, location_id, quantity, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(sku_id, location_id) DO UPDATE SET quantity=excluded.quantity, updated_at=excluded.updated_at",
            params![
                stock.get("sku_id").and_then(|v| v.as_i64()),
                stock.get("location_id").and_then(|v| v.as_i64()),
                stock.get("quantity").and_then(|v| v.as_f64()),
                stock.get("updated_at").and_then(|v| v.as_str()),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    db::set_state(&conn, "last_synced_at", &resp.cursor)?;

    Ok(true)
}

async fn push_outbox(
    state: &State<'_, SyncState>,
    token: &str,
    device_id: &str,
) -> Result<(usize, usize, usize), String> {
    #[derive(Serialize)]
    struct OpPayload {
        client_op_id: String,
        sku_id: i64,
        location_id: i64,
        #[serde(rename = "type")]
        op_type: String,
        quantity: f64,
        notes: Option<String>,
    }

    let pending: Vec<OpPayload> = {
        let conn = state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT client_op_id, sku_id, location_id, op_type, quantity, notes
                 FROM outbox_operations WHERE status = 'pending' LIMIT 100",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(OpPayload {
                    client_op_id: row.get(0)?,
                    sku_id: row.get(1)?,
                    location_id: row.get(2)?,
                    op_type: row.get(3)?,
                    quantity: row.get(4)?,
                    notes: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    if pending.is_empty() {
        return Ok((0, 0, 0));
    }

    let pushed_count = pending.len();
    let body = serde_json::json!({ "device_id": device_id, "operations": pending });

    let resp = state
        .http
        .post(format!("{API_BASE}/api/v1/inventory/desktop/sync/push"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<PushResponse>()
        .await
        .map_err(|e| e.to_string())?;

    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let mut applied = 0usize;
    let mut failed = 0usize;

    for result in &resp.results {
        match result.status.as_str() {
            "applied" => applied += 1,
            "failed" => failed += 1,
            _ => {}
        }
        conn.execute(
            "UPDATE outbox_operations SET status = ?1, error_message = ?2 WHERE client_op_id = ?3",
            params![result.status, result.message, result.client_op_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok((pushed_count, applied, failed))
}
