import { LoggerModule } from 'nestjs-pino';
import { trace } from '@opentelemetry/api';
import { v4 as uuidv4 } from 'uuid';
import { sanitizeFields, sanitizePath } from './sanitize';
import type { IncomingMessage } from 'http';

export const PinoLoggerModule = LoggerModule.forRootAsync({
  useFactory: () => ({
    pinoHttp: {
      autoLogging: true,
      genReqId: (req: IncomingMessage) => (req.id as string | undefined) ?? uuidv4(),
      mixin: () => {
        const span = trace.getActiveSpan();
        if (!span) return {};
        const { traceId, spanId } = span.spanContext();
        return { traceId, spanId };
      },
      // Redact sensitive headers + query params via pino's built-in redaction
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["stripe-signature"]',
          'req.query.email',
          'req.query.token',
        ],
        censor: '[REDACTED]',
      },
      // Dev: pretty-print; Prod: JSON to stdout + rotating files
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
          : {
              targets: [
                { target: 'pino/file', options: { destination: 1 } },
                {
                  target: 'pino-roll',
                  level: 'error' as const,
                  options: { file: 'logs/error.log', size: '10m', limit: { count: 5 } },
                },
                {
                  target: 'pino-roll',
                  options: { file: 'logs/combined.log', size: '50m', limit: { count: 5 } },
                },
              ],
            },
      level: process.env.LOG_LEVEL ?? 'info',
      // Serializers with PCI-compliant field redaction
      serializers: {
        req(req: IncomingMessage) {
          const body = sanitizeFields(((req as unknown as Record<string, unknown>).body ?? {}) as Record<string, unknown>);
          return {
            id: req.id,
            method: req.method,
            url: sanitizePath(req.url ?? ''),
            remoteAddress: req.socket?.remoteAddress,
            body,
          };
        },
        res(res: { statusCode: number }) {
          return { statusCode: res.statusCode };
        },
      },
    },
  }),
});
