# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Authentication
- Use cookie-based authentication with Passport.js, not Bearer tokens. Confidence: 0.85
- No guest checkout - all payments require authenticated users. Confidence: 0.80
- Extract user context via @CurrentUser decorator from Passport request. Confidence: 0.75

# Frontend Architecture
- Use TanStack Query v5 for data fetching, not RTK Query. Confidence: 0.85
- Wrap all frontend services in ES6 classes with singleton exports. Confidence: 0.85
- Separate business logic, domain logic, and UI logic (clean architecture). Confidence: 0.80

# Backend Architecture
- Use raw SQL queries with TypeORM, avoid ORM query builders. Confidence: 0.85
- Move all database operations into dedicated repository files project-wide. Confidence: 0.80
- Use Redis for caching, session storage, and rate limiting. Confidence: 0.80

# Logging & Observability
- Use NestJS Pino with OpenTelemetry for logging and tracing. Confidence: 0.80
- Use Signoz for observability/monitoring. Confidence: 0.75

# Stripe Integration
- Use embedded Payment Element with redirect: 'if_required', no external redirects. Confidence: 0.85
- Default currency to GBP where payment method supports it. Confidence: 0.75
- Support multiple payment methods: card, SEPA, ACH, BACS, BECS, Bancontact, EPS, P24, Link, Amazon Pay, Revolut Pay. Confidence: 0.70

# Code Quality
- Follow software engineering principles: DRY, AHA, POLA, SOLID, KISS, YAGNI, Twelve-Factor App, Separation of Concerns. Confidence: 0.85
- Avoid "AI slop" and over-engineered code - keep solutions simple and production-focused. Confidence: 0.85
- Add comprehensive code comments. Confidence: 0.75

# Testing
- Use Playwright for E2E browser testing with AI-driven user simulation. Confidence: 0.80
- Test both positive and negative scenarios including declined cards. Confidence: 0.75

# Database
- Use Oracle XE with Docker for database. Confidence: 0.75
- Use TypeORM entities for schema definition but raw SQL for queries. Confidence: 0.80

# UI/UX
- Admin panel/console design pattern for dashboards. Confidence: 0.75
- User enters amount first, then selects payment method. Confidence: 0.75

# Development Workflow
- Spawn parallel agent teams for complex research and implementation tasks. Confidence: 0.75
- Use "think hardest" approach for complex architectural decisions. Confidence: 0.70
