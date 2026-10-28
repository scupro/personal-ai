-- Personal AI v1 sync storage.
-- One row per logical item (chat, document, project, prompt list, setting).
-- Values are JSON strings; deletes are tombstones so they propagate.
CREATE TABLE IF NOT EXISTS sync_items (
  owner_id   TEXT    NOT NULL DEFAULT 'owner',
  item_key   TEXT    NOT NULL,
  value      TEXT,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_sync_items_updated
  ON sync_items (owner_id, updated_at);