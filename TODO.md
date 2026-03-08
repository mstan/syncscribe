# SyncScribe - Manual Setup Tasks

## Required Setup (before first run)

### 1. Google OAuth
- [x] Go to [Google Cloud Console](https://console.cloud.google.com/)
- [x] Create project: `syncscribe-489503`
- [x] Create OAuth 2.0 Client ID
- [x] Dev origins configured: `http://localhost:5173`, `http://localhost:3000`
- [x] Client ID: `513444390422-ee71eavkvqdpqdpp4hbfi0atgp2q1ut7.apps.googleusercontent.com`
- [ ] **REVISIT when domain is chosen**: Update origins + redirect URIs at:
  https://console.cloud.google.com/auth/clients/create?project=syncscribe-489503
- [x] Copy Client ID to `GOOGLE_CLIENT_ID` in `.env`
- [x] Copy Client ID to `VITE_GOOGLE_CLIENT_ID` in `client/.env`

### 2. Stripe
- [ ] Create a [Stripe account](https://dashboard.stripe.com/)
- [ ] Get API keys from Developers → API keys
- [ ] Copy Secret Key to `STRIPE_SECRET_KEY` in `.env`
- [ ] Set up webhook endpoint:
  - URL: `https://yourdomain.com/api/stripe/webhook`
  - Events: `checkout.session.completed`
- [ ] Copy Webhook Signing Secret to `STRIPE_WEBHOOK_SECRET` in `.env`
- [ ] (Optional) Create Stripe Products/Prices for credit packs and add `stripe_price_id` to `credit_packs` table

### 3. Cloudflare R2
- [ ] Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
- [ ] Go to R2 → Create Bucket → Name: `syncscribe`
- [ ] Go to R2 → Manage R2 API Tokens → Create API Token
- [ ] Permissions: Object Read & Write
- [ ] Copy endpoint, access key, and secret to `.env`

### 4. PostgreSQL
- [ ] Create database: `CREATE DATABASE syncscribe;`
- [ ] Create user: `CREATE USER syncscribe WITH PASSWORD 'your_password';`
- [ ] Grant privileges: `GRANT ALL PRIVILEGES ON DATABASE syncscribe TO syncscribe;`
- [ ] Update `DATABASE_URL` in `.env`
- [ ] Schema will be auto-created on first run (bootstrap.sql)

### 5. Domain & SSL
- [ ] Choose and register domain
- [ ] Point DNS to your server
- [ ] Set up SSL (Let's Encrypt / Cloudflare)
- [ ] Update `CORS_ORIGINS` in `.env`
- [ ] Update Google OAuth authorized origins
- [ ] Update Stripe webhook URL

### 6. Environment
- [ ] Copy `.env.example` to `.env` and fill in all values
- [ ] Set `JWT_SECRET` to a strong random string (e.g., `openssl rand -hex 32`)
- [ ] Set `NODE_ENV=production` for production deployment

## Development Quick Start

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
npm run client:install

# Copy env file and configure
cp .env.example .env
# Edit .env with your values

# Start backend (with auto-reload)
npm run dev

# Start frontend (in another terminal)
npm run client:dev
```

## Production Deployment

```bash
# Build frontend
npm run client:build

# Start with PM2
pm2 start ecosystem.config.js

# Or start directly
NODE_ENV=production node app.js
```
