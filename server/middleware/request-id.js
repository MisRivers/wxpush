/**
 * 请求 ID 中间件：
 * - 把 Fastify 已生成的 req.id 回写到响应头 x-request-id
 * - 同时挂到 reply.locals.requestId
 */
export function registerRequestId(app) {
  app.addHook('onRequest', async (req) => {
    // req.id 已由 Fastify genReqId 生成（取自 x-request-id 头或随机）
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.id);
    return payload;
  });
}

export default { registerRequestId };
