// =============================================================================
// PM2 Ecosystem Configuration — Production (EC2)
// =============================================================================
//
// PURPOSE:
//   Manages the NestJS Stripe API in cluster mode on an EC2 instance.
//   Provides zero-downtime reloads, automatic restart on crash, log
//   aggregation, and environment variable management for OpenTelemetry.
//
// WHY PM2 (INSTEAD OF DOCKER FOR THE APP ITSELF):
//   - PM2 provides cluster mode (one worker per CPU core) without an
//     external load balancer — it manages the cluster natively.
//   - Zero-downtime reloads: pm2 reload restarts workers one at a time,
//     draining connections before killing each worker.
//   - Built-in log management, restart policies, and memory limits.
//   - Simpler than Docker for a single EC2 instance — no need for a
//     container orchestrator.
//
//   The LGTM observability stack runs in Docker Compose alongside PM2.
//   This split keeps the app process lightweight (one Node.js process per
//   worker, no extra container overhead) while observability benefits
//   from Docker's pre-built images and isolated networking.
//
// CLUSTER MODE:
//   instances: 'max' → uses os.cpus().length workers.
//   exec_mode: 'cluster' → workers share the same port via PM2's internal
//   round-robin load balancer. Each worker gets its own event loop thread,
//   maximizing throughput on multi-core machines.
//
// DEPLOYMENT:
//   1. Deploy code to: /home/ec2-user/stripe-api/apps/api/
//   2. Install deps:   cd /home/ec2-user/stripe-api/apps/api && npm ci --omit=dev
//   3. Build:          npm run build
//   4. Create logs dir: mkdir -p logs
//   5. Start:          pm2 start ecosystem.config.js --env production
//   6. Save for reboot: pm2 save && pm2 startup systemd
//
// GRACEFUL SHUTDOWN:
//   kill_timeout: 30000 matches NestJS's app.close() behavior (30s drain).
//   shutdown_with_message: true sends a shutdown message before SIGKILL,
//   giving the app's gracefulShutdown handler time to close DB connections,
//   flush OTel spans, and drain in-flight requests.
//
// MEMORY LIMITS:
//   max_memory_restart: '512M' — if a worker's RSS exceeds 512MB, PM2
//   restarts it. This prevents memory leaks from taking down the instance.
//   NODE_OPTIONS: --max-old-space-size=512 limits V8 heap to 512MB, so GC
//   runs before PM2 kills the process.
//
// LOG HANDLING:
//   - pino-roll handles structured application logs (JSON to rotating files)
//   - PM2 logs are secondary: crash reports, startup messages, uncaught
//     exceptions that bypass pino.
//   - Alloy tails the pino-roll files and ships to Loki.
//   - PM2 logs are not shipped to Loki (they're unstructured and low-volume).
//
// ENVIRONMENT VARIABLES:
//   OTEL_SERVICE_NAME: 'stripe-api'
//     Identifies this service in Tempo traces and service graphs.
//
//   OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318'
//     Points to Tempo's OTLP HTTP receiver. On the same EC2 instance,
//     Docker port mapping makes Tempo available at localhost:4318.
//
//   OTEL_TRACES_SAMPLER: 'parentbased_traceidratio'
//     Respects the sampling decision of the parent span (incoming request).
//     If no parent (root span), uses the configured ratio.
//
//   OTEL_TRACES_SAMPLER_ARG: '0.1'
//     10% sampling in production. This controls trace volume and storage
//     cost. Adjust higher for debugging, lower for cost savings.
//     10% means: for 1000 requests/sec, we store 100 traces/sec.
//     With avg 10 spans/trace and 1 KB/span, that's ~1 MB/sec → ~86 GB/day
//     uncompressed. Tempo's parquet compression reduces this ~5x.
// =============================================================================

module.exports = {
  apps: [
    {
      name: 'stripe-api',
      script: './dist/main.js',               // NestJS compiled output
      cwd: '/home/ec2-user/stripe-api/apps/api', // Working directory on EC2

      // === Cluster Mode ===
      // 'max' = one worker per CPU core.
      // PM2_INSTANCES env var allows override: PM2_INSTANCES=2 pm2 start ...
      // For a t3.large (2 vCPU): 2 workers. t3.xlarge (4 vCPU): 4 workers.
      // Each worker handles ~500-1000 req/s depending on workload.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',                   // Round-robin load balancing between workers

      // === Environment Variables ===
      // The 'env' block is the base. 'env_production' overrides when
      // --env production is passed.
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_PREFIX: 'api/v1',
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',                   // Pino outputs JSON for Loki/Alloy
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        API_PREFIX: 'api/v1',
        LOG_LEVEL: process.env.LOG_LEVEL || 'info',
        LOG_FORMAT: 'json',

        // === OpenTelemetry Configuration ===
        // These env vars are read by instrumentation.ts and the OTel SDK.

        // Service name — appears in Tempo as the service.name attribute.
        // Used to group spans in service graphs and RED dashboards.
        OTEL_SERVICE_NAME: 'stripe-api',

        // OTLP exporter endpoint — sends traces to Tempo's HTTP receiver.
        // Tempo runs in Docker Compose with port 4318 mapped to localhost.
        // The SDK appends /v1/traces to this URL (configured in instrumentation.ts).
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',

        // Trace sampling strategy:
        //   parentbased_traceidratio: if the incoming request has a trace
        //   context (sampled flag), honor it. Otherwise, sample at ratio.
        //   This ensures we don't break distributed traces from upstream.
        OTEL_TRACES_SAMPLER: 'parentbased_traceidratio',

        // Sampling ratio: 10% of root spans are sampled.
        // Increase to 1.0 for debugging, decrease to 0.01 for high-traffic.
        OTEL_TRACES_SAMPLER_ARG: '0.1',

        // === Node.js Memory Limits ===
        // Limits V8 heap to 512MB. PM2's max_memory_restart at 512M acts
        // as a safety net if the heap limit isn't sufficient.
        NODE_OPTIONS: '--max-old-space-size=512',
      },

      // === Process Management ===
      max_memory_restart: '512M',      // Restart worker if RSS exceeds 512MB
      kill_timeout: 30000,             // 30s graceful shutdown before SIGKILL
                                       // Must match NestJS's app.close() drain timeout
      listen_timeout: 10000,           // Wait 10s for the port to be bound
                                       // before considering the worker started
      shutdown_with_message: true,     // Send 'shutdown' message via IPC before
                                       // SIGKILL — allows graceful shutdown handler
                                       // to run (close DB, flush OTel, drain requests)

      // === Restart Policy ===
      // Prevents infinite restart loops from taking down the machine.
      // If the app restarts more than 10 times within the restart_delay
      // window, PM2 stops trying and marks the process as errored.
      max_restarts: 10,                // Max restarts within the window below
      restart_delay: 5000,             // 5s cooldown between restart attempts
      min_uptime: '10s',               // App must survive 10s to reset restart counter
      autorestart: true,               // Automatically restart on crash/exit

      // === PM2 Log Handling ===
      // PM2 captures stdout and stderr from each worker.
      // These are crash logs, startup messages, and uncaught exceptions.
      // Structured application logs are written separately by pino-roll.
      error_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-error.log',
      out_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-out.log',
      log_file: '/home/ec2-user/stripe-api/apps/api/logs/pm2-combined.log',
      merge_logs: true,                // Merge all cluster workers' logs into one stream
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // === PM2 Log Rotation ===
      // These rotation settings apply to PM2-managed logs only.
      // pino-roll handles rotation for application logs separately.
      max_size: '10M',
      retain: 5,

      // === File Watching ===
      // Disabled in production — watching files on a production server
      // wastes CPU and can trigger unwanted restarts.
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git'],

      // === Instance Identification ===
      // Each worker gets a unique INSTANCE_ID (e.g., 0, 1, 2, 3).
      // Useful for log correlation in multi-worker setups.
      instance_var: 'INSTANCE_ID',
    },
  ],
};
