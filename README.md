# HALF MAGIC — Makeup is Play

A responsive beauty storefront with a dark editorial visual system and acid-lime accents.

## Connected commerce stack
- Supabase Auth for email/password registration, sign-in, session persistence and sign-out
- Supabase Postgres for products, orders, order items and inventory
- Node.js / Express API for protected checkout-session creation and customer order history
- Stripe-hosted Checkout for test-mode card payment
- Signed Stripe webhooks to confirm paid orders and release stock on expired/failed checkout
- Existing product discovery, wishlist, cart and experimental MediaPipe try-on UI

## Setup

### 1. Supabase
1. Create a Supabase project.
2. Run supabase/schema.sql in the Supabase SQL Editor. This creates the tables, RLS policies, inventory functions and four starter HALF MAGIC products.
3. In Supabase Authentication settings, configure your site URL and allowed redirect URLs for your local/deployed storefront.
4. For a quick test, you may disable email confirmation in Supabase Auth. For production, keep email confirmation enabled and configure SMTP.

### 2. Browser configuration
1. Copy config.js.example to config.js.
2. Fill in supabaseUrl and the Supabase anon/publishable key from Project Settings → API.
3. config.js is gitignored. The browser key is designed to be public; never put the Supabase service-role key or Stripe secret in this file.
4. The page loads Supabase JS v2 from jsDelivr. Serve the site over localhost or HTTPS.

### 3. Server and Stripe test mode
1. Copy .env.example to .env.
2. Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (use an sk_test_... key), STRIPE_WEBHOOK_SECRET, and APP_ORIGIN.
3. Run npm install, then npm run dev.
4. In Stripe Dashboard, create a webhook endpoint pointing to https://YOUR_HOST/api/stripe/webhook for:
   - checkout.session.completed
   - checkout.session.async_payment_succeeded
   - checkout.session.expired
   - checkout.session.async_payment_failed
5. For local webhook testing, use Stripe CLI to forward events to localhost:4242/api/stripe/webhook and put the CLI-provided signing secret in .env.

## Connected customer flow
1. Register or sign in from the account page. Supabase Auth manages credentials and sessions.
2. Add products to the bag. The cart remains browser-local in this iteration.
3. Continue to checkout. The browser sends product IDs and quantities with the Supabase access token; the server looks up prices and reserves inventory in a database transaction.
4. The server creates a Stripe Checkout Session and redirects the customer to Stripe-hosted checkout.
5. Stripe sends a signed webhook. Only a verified paid event marks the order paid; expired or failed sessions release reserved stock.
6. The account page can display order history from the authenticated API.

## API
- GET /api/health
- GET /api/products
- POST /api/checkout/session (authenticated; body: {"items":[{"product_id":"<uuid>","quantity":1}]})
- GET /api/orders (authenticated)
- POST /api/stripe/webhook (Stripe signature required)

## Current limitations — not production-ready yet
- The storefront cart and wishlist are still stored in localStorage; only the checkout order, payment and inventory reservation are server-side.
- Browser product cards use the existing static catalog. Checkout maps cart product names to active database product names; do not rename a database product without updating the storefront mapping.
- The success page confirms the Stripe redirect only. The signed webhook is the source of truth for paid order status; allow a moment for the order history to update.
- This implementation has not been run against your actual Supabase project or Stripe account because credentials and webhook configuration must be supplied by the project owner.
- Before launch, test email verification, password reset, duplicate webhook delivery, abandoned sessions, stock contention, refunds, tax, shipping, fulfillment, privacy/consent, rate limiting and end-to-end security.
- Live try-on is an experimental face-landmark color overlay, not shade-accurate commercial AR. Segmentation, lighting/color calibration, occlusion and device performance remain future work.

## Run
- Frontend + API: npm install && npm run dev
- Open http://localhost:4242
