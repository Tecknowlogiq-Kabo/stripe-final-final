import * as winston from 'winston';
import { WinstonModule } from 'nest-winston';

export const LoggingModule = WinstonModule.forRootAsync({
  useFactory: () => ({
    transports: [
      new winston.transports.Console({
        format:
          process.env.NODE_ENV === 'production'
            ? winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json(),
              )
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ level, message, timestamp, ...meta }) => {
                  const metaStr = Object.keys(meta).length
                    ? ' ' + JSON.stringify(meta)
                    : '';
                  return `${timestamp} [${level}] ${message}${metaStr}`;
                }),
              ),
      }),
      ...(process.env.NODE_ENV === 'production'
        ? [
            new winston.transports.File({
              filename: 'logs/error.log',
              level: 'error',
              maxsize: 10 * 1024 * 1024, // 10 MB per file
              maxFiles: 5,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            new winston.transports.File({
              filename: 'logs/combined.log',
              maxsize: 50 * 1024 * 1024, // 50 MB per file
              maxFiles: 5,
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
          ]
        : []),
    ],
    level: process.env.LOG_LEVEL ?? 'info',
  }),
});
