# HALF MAGIC — Makeup is Play

A responsive beauty storefront prototype with a dark editorial visual system and acid-lime accents.

## Frontend prototype
- Responsive brand landing page and product cards
- Product detail views, wishlist, cart and demo checkout
- Local order history and order detail views
- Product category filters, keyword search and price sorting
- Browser-local demo account and saved preferences
- Live camera try-on prototype powered by MediaPipe Face Landmarker

## Commerce backend foundation (new)
The repository now includes a Node.js API foundation using Supabase (Postgres + Auth) and Stripe Checkout:
- `server.js`: health check, database-backed product listing, authenticated checkout-session creation, authenticated order history and signed Stripe webhook handling.
- `supabase/schema.sql`: product, order and order-item tables; row-level security policies; atomic stock reservation; idempotent payment completion; reservation release.
- `package.json`: server dependencies and run scripts.
- `.env.example`: required server environment variables. Copy to `.env` and fill in values; never commit `.env`.

### Setup
1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. Add product rows to `public.products` with prices stored as integer cents and an initial stock quantity.
3. Copy `.env.example` to `.env`. Set the Supabase project URL, service-role key, Stripe secret key, Stripe webhook signing secret, and the public app origin.
4. Run `npm install`, then `npm run dev`.
5. Configure a Stripe webhook endpoint at `/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, and `checkout.session.async_payment_failed`.
6. Use Supabase Auth in the browser to register/sign in. Send the resulting access token as `Authorization: Bearer <access_token>` to protected API routes. Only the Supabase anon/publishable key belongs in browser code; the service-role key and Stripe secret remain server-side.

### API
- `GET /api/health`
- `GET /api/products`
- `POST /api/checkout/session` (authenticated; body: `{"items":[{"product_id":"<uuid>","quantity":1}]}`)
- `GET /api/orders` (authenticated)
- `POST /api/stripe/webhook` (Stripe signature required)

**Integration status:** this is a backend foundation, not yet a fully switched-over storefront. The current browser UI still contains local demo account/cart/checkout flows; it must be connected to Supabase Auth and these API endpoints before real customers can place orders. Configure and test the Supabase project and Stripe test mode before any production use.

## Prototype boundaries and launch checklist
- The existing local demo account, cart and saved looks still use browser localStorage.
- Existing demo checkout does not collect payment; the new Stripe endpoint is not yet wired into that UI.
- Stock is reserved atomically when the API creates an order and released on Stripe expiration/failure; monitor abandoned checkout sessions and configure webhook retries.
- Test webhook signature verification, duplicate webhook delivery, concurrent checkout, failed payments, cancellations, refunds, tax, shipping, and inventory reconciliation before launch.
- Live try-on is an experimental face-landmark color overlay, not shade-accurate commercial AR. Improving segmentation, lighting/color calibration, occlusion and device performance remains a separate AR workstream.
- MediaPipe runtime/model assets load from external CDNs; camera access requires HTTPS or localhost and explicit permission.
- Production launch still requires frontend auth/checkout integration, privacy/consent flows, fulfillment, customer support, security review and end-to-end testing.
