import { LoggerModule } from 'nestjs-pino';
import { trace, context } from '@opentelemetry/api';
import { v4 as uuidv4 } from 'uuid';
import type { Request } from 'express';

export const PinoLoggerModule = LoggerModule.forRootAsync({
  useFactory: () => ({
    pinoHttp: {
      // Auto-log every request/response — replaces LoggingInterceptor
      autoLogging: true,
      // Resolve request ID from incoming header or generate a new UUID.
      // CorrelationIdMiddleware runs first and sets req.id, so pino-http
      // picks it up via genReqId and binds it to every log line in the request.
      genReqId: (req: Request & { id?: string }) => req.id ?? uuidv4(),
      // Inject active OpenTelemetry trace/span IDs into every log record
      mixin: () => {
        const span = trace.getActiveSpan();
        if (!span) return {};
        const { traceId, spanId } = span.spanContext();
        return { traceId, spanId };
      },
      // Redact sensitive headers from request/response log lines
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["stripe-signature"]',
        ],
        censor: '[REDACTED]',
      },
      // Dev: pretty-print; Prod: JSON
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: false } }
          : undefined,
      level: process.env.LOG_LEVEL ?? 'info',
      // Serialize request and response with concise fields
      serializers: {
        req(req: Request & { id?: string }) {
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
