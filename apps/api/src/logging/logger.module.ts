import { LoggerModule } from 'nestjs-pino';
import { trace } from '@opentelemetry/api';
import { v4 as uuidv4 } from 'uuid';
import type { IncomingMessage } from 'http';

export const PinoLoggerModule = LoggerModule.forRootAsync({
  useFactory: () => ({
    pinoHttp: {
      // Auto-log every request/response — replaces LoggingInterceptor
      autoLogging: true,
      // Resolve request ID from incoming header or generate a new UUID.
      // CorrelationIdMiddleware runs first and sets req.id, so pino-http
      // picks it up via genReqId and binds it to every log line in the request.
      genReqId: (req: IncomingMessage) => (req.id as string | undefined) ?? uuidv4(),
      // Inject active OpenTelemetry trace/span IDs into every log record
      mixin: () => {
        const span = trace.getActiveSpan();
        if (!span) return {};
        const { traceId, spanId } = span.spanContext();
        return { traceId, spanId };
      },
      // Redact sensitive headers and query params from request/response log lines
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
      // Serialize request and response with concise fields
      serializers: {
        req(req: IncomingMessage) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            remoteAddress: req.socket?.remoteAddress,
          };
        },
      },
    },
  }),
});
