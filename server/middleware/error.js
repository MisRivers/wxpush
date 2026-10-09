/**
 * 统一错误处理：把 Error 转为 HTTP 响应
 *
 * 错误响应格式：
 * - HTTP 状态码反映网络层失败 / 鉴权失败
 * - body.code 反映业务错误码
 * - body.message 人类可读消息
 *
 * 业务错误类 AppError：可携带 { statusCode, code, message, headers }
 */
export class AppError extends Error {
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = opts.statusCode || 400;
    this.headers = opts.headers || {};
  }
}

export function buildErrorResponse(err) {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      headers: { 'cache-control': 'no-store', ...err.headers },
      body: { code: err.code, message: err.message },
    };
  }
  // 未知错误统一 500
  return {
    statusCode: 500,
    headers: { 'cache-control': 'no-store' },
    body: { code: 50000, message: 'internal server error' },
  };
}

export function registerErrorHandler(app) {
  app.setErrorHandler((err, req, reply) => {
    // Fastify 内置验证错误
    if (err.validation) {
      const r = buildErrorResponse(new AppError(40001, `validation failed: ${err.message}`, { statusCode: 400 }));
      reply.code(r.statusCode).headers(r.headers).send(r.body);
      return;
    }
    const r = buildErrorResponse(err);
    reply.code(r.statusCode).headers(r.headers).send(r.body);
  });
}

export default { AppError, registerErrorHandler };
