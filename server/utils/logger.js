import pino from 'pino';
import config from '../config.js';

// pino 实例（生产 JSON；dev 模式下若希望 pretty 输出可设置 LOG_PRETTY=1）
const usePretty = config.NODE_ENV !== 'production' && process.env.LOG_PRETTY === '1';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'wxpush' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

export default logger;
