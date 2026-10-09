/**
 * CSV 工具：转义 + 公式注入防护
 *
 * 公式注入防护：如果单元格值以 = + - @ Tab(0x09) 回车(0x0D) 换行(0x0A) 开头，
 * 在值前面加单引号 '，让 Excel/Numbers 将其当作文本而非公式。
 *
 * 参考：OWASP CSV Injection Prevention Cheat Sheet
 */

const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

/**
 * 转义 CSV 单元格：包裹双引号，内部双引号转双倍
 */
function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);

  // 公式注入防护
  let safe = str;
  if (str.length > 0 && FORMULA_PREFIXES.has(str[0])) {
    safe = "'" + str;
  }

  // 包裹双引号，内部 " 转义为 ""
  if (/[",\r\n]/.test(safe)) {
    return '"' + safe.replace(/"/g, '""') + '"';
  }
  return safe;
}

/**
 * 将二维数组转换为 CSV 字符串
 * @param {string[]} headers
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
export function toCSV(headers, rows) {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((_, i) => escapeCell(row[i])).join(','));
  }
  return lines.join('\r\n'); // CSV 标准换行为 CRLF
}

export default { toCSV };
