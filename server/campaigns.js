import { validateCampaign, MAX_CAMPAIGN_BYTES } from '../src/application/campaigns.js';

export class APIError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function expectedRevision(header) {
  if (header === undefined) throw new APIError(428, 'A campaign revision is required.');
  if (!/^"(0|[1-9]\d*)"$/.test(header)) throw new APIError(400, 'Invalid campaign revision.');
  const value = Number(header.slice(1, -1));
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER)
    throw new APIError(400, 'Invalid campaign revision.');
  return value;
}

export function saveCampaign(db, owner, id, expected, value) {
  let campaign;
  try {
    campaign = validateCampaign(value);
  } catch (error) {
    throw new APIError(400, error.message);
  }
  if (campaign.id !== id) throw new APIError(400, 'Campaign identity does not match the URL.');
  const document = JSON.stringify(campaign);
  if (Buffer.byteLength(document) > MAX_CAMPAIGN_BYTES)
    throw new APIError(413, 'The campaign exceeds the 4 MB limit.');
  const now = new Date().toISOString();
  return db
    .transaction(() => {
      let row;
      if (expected === 0) {
        if (
          db
            .prepare(
              'SELECT COUNT(*) AS count FROM campaigns WHERE owner_id = ? AND deleted_at IS NULL',
            )
            .get(owner).count >= 100
        )
          throw new APIError(409, 'The account has reached its 100 campaign storage limit.');
        row = db
          .prepare(
            `INSERT INTO campaigns (owner_id, id, revision, document, updated_at)
        VALUES (?, ?, 1, ?, ?) ON CONFLICT(owner_id, id) DO NOTHING RETURNING revision`,
          )
          .get(owner, id, document, now);
      } else {
        row = db
          .prepare(
            `UPDATE campaigns SET document = ?, revision = revision + 1, updated_at = ?
        WHERE owner_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL RETURNING revision`,
          )
          .get(document, now, owner, id, expected);
      }
      if (!row)
        throw new APIError(
          409,
          'The account copy changed or was deleted. Both versions have been kept.',
        );
      return { campaign, revision: row.revision, updatedAt: now };
    })
    .immediate();
}

export function getCampaign(db, owner, id) {
  const row = db
    .prepare(
      `SELECT document, revision, updated_at FROM campaigns
    WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
    )
    .get(owner, id);
  if (!row) throw new APIError(404, 'Campaign not found.');
  return { campaign: JSON.parse(row.document), revision: row.revision, updatedAt: row.updated_at };
}

export function deleteCampaign(db, owner, id, expected) {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `UPDATE campaigns SET document = NULL, deleted_at = ?, updated_at = ?,
    revision = revision + 1 WHERE owner_id = ? AND id = ? AND revision = ?
    AND deleted_at IS NULL RETURNING revision`,
    )
    .get(now, now, owner, id, expected);
  if (!row)
    throw new APIError(409, 'The account copy changed or was deleted. Refresh before deleting.');
  return { revision: row.revision };
}
