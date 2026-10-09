import { getDB } from '../../db/index.js';
import { AppError } from '../../middleware/error.js';
import { adminAuthRequired } from '../../middleware/auth.js';
import { toCSV } from '../../utils/csv.js';

const auth = { preHandler: [adminAuthRequired] };

const MAX_CSV_ROWS = 10000;
const DEFAULT_PAGE_SIZE = 50;

/**
 * 推送日志：
 * - GET /api/admin/logs          分页 ?page=&limit=&token_id=&status=&start=&end=
 * - GET /api/admin/logs/export   CSV 导出（上限 10000，公式注入防护）
 */
export function registerLogRoutes(app) {
  app.get('/api/admin/logs', { ...auth }, listLogs);
  app.get('/api/admin/logs/export', { ...auth }, exportLogs);
  app.get('/api/admin/logs/:id', { ...auth }, getLogDetail);
}

async function listLogs(req, reply) {
  const db = getDB();
  const q = req.query || {};
  const page = q.page ? Math.max(Number(q.page), 1) : 1;
  const limit = Math.min(Math.max(Number(q.limit) || DEFAULT_PAGE_SIZE, 1), 200);
  const offset = (page - 1) * limit;
  const tokenId = q.token_id ? Number(q.token_id) : null;
  const status = q.status ? String(q.status) : null;
  const start = q.start ? Number(q.start) : null;
  const end = q.end ? Number(q.end) : null;

  const where = [];
  const vals = [];
  if (tokenId) { where.push('l.token_id = ?'); vals.push(tokenId); }
  if (status) { where.push('l.status = ?'); vals.push(status); }
  if (start) { where.push('l.created_at >= ?'); vals.push(start); }
  if (end) { where.push('l.created_at < ?'); vals.push(end); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const totalRow = db.prepare(`SELECT COUNT(*) as total FROM logs l ${whereClause}`).get(...vals);
  const total = totalRow.total;

  const rows = db.prepare(`
    SELECT l.id, l.token_value, l.token_id, l.channel_type, l.channel_id,
           l.msg_type, l.status, l.error_code, l.error_message,
           l.client_ip, l.request_id, l.duration_ms, l.created_at
    FROM logs l
    ${whereClause}
    ORDER BY l.id DESC
    LIMIT ? OFFSET ?
  `).all(...vals, limit, offset);

  reply.send({
    code: 0,
    data: rows,
    pagination: { page, limit, total },
  });
}

async function getLogDetail(req, reply) {
  const db = getDB();
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT l.id, l.token_value, l.token_id, l.channel_type, l.channel_id,
           l.msg_type, l.request_body, l.response_body, l.status,
           l.error_code, l.error_message, l.client_ip, l.request_id,
           l.duration_ms, l.created_at
    FROM logs l WHERE l.id=?
  `).get(id);
  if (!row) throw new AppError(40401, 'log not found', { statusCode: 404 });
  reply.send({ code: 0, data: row });
}

async function exportLogs(req, reply) {
  const db = getDB();
  const q = req.query || {};
  const tokenId = q.token_id ? Number(q.token_id) : null;
  const status = q.status ? String(q.status) : null;
  const start = q.start ? Number(q.start) : null;
  const end = q.end ? Number(q.end) : null;

  const where = [];
  const vals = [];
  if (tokenId) { where.push('token_id = ?'); vals.push(tokenId); }
  if (status) { where.push('status = ?'); vals.push(status); }
  if (start) { where.push('created_at >= ?'); vals.push(start); }
  if (end) { where.push('created_at < ?'); vals.push(end); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT id, token_value, token_id, channel_type, msg_type, status,
           error_code, error_message, client_ip, request_id, duration_ms, created_at
    FROM logs
    ${whereClause}
    ORDER BY id DESC
    LIMIT ?
  `).all(...vals, MAX_CSV_ROWS + 1);

  const truncated = rows.length > MAX_CSV_ROWS;
  const exportRows = truncated ? rows.slice(0, MAX_CSV_ROWS) : rows;

  const headers = ['id', 'token', 'token_id', 'channel', 'msg_type', 'status', 'error_code', 'error_message', 'client_ip', 'request_id', 'duration_ms', 'created_at', 'created_at_local'];
  const csvRows = exportRows.map(r => [
    r.id, r.token_value, r.token_id || '', r.channel_type, r.msg_type, r.status,
    r.error_code ?? '', r.error_message || '', r.client_ip || '', r.request_id || '',
    r.duration_ms ?? '', r.created_at,
    new Date(r.created_at * 1000).toISOString(),
  ]);

  const csv = toCSV(headers, csvRows);
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="push-logs-${Date.now()}.csv"`);
  reply.send(csv);
}

export default { registerLogRoutes };
