CREATE TABLE campaigns (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  revision INTEGER NOT NULL CHECK (revision > 0),
  document TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (owner_id, id),
  CHECK ((document IS NULL) = (deleted_at IS NOT NULL))
);
CREATE INDEX campaigns_owner_updated ON campaigns(owner_id, updated_at);
