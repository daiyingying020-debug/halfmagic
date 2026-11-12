require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = Number(process.env.PORT || 4242);
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing required environment variables:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
const appOrigin = process.env.APP_ORIGIN || "http://localhost:4242";

// Stripe requires the raw request body for signature verification.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      if (session.payment_status === "paid") {
        const { error } = await supabase.rpc("complete_paid_order", {
          p_order_id: session.metadata.order_id,
          p_stripe_session_id: session.id,
          p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null
        });
        if (error) throw error;
      }
    }
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object;
      const { error } = await supabase.rpc("release_order_reservation", { p_order_id: session.metadata.order_id });
      if (error) throw error;
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook processing failed:", err);
    return res.status(500).json({ error: "Webhook processing failed; Stripe can retry this event." });
  }
});

app.use(express.json({ limit: "32kb" }));
app.use(express.static("."));

async function requireUser(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Sign in is required." });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "Session is invalid or expired." });
  req.user = data.user;
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "halfmagic-commerce-api" }));

app.get("/api/products", async (_req, res) => {
  const { data, error } = await supabase.from("products")
    .select("id, slug, name, description, price_cents, currency, category, image_url, stock")
    .eq("active", true).order("name");
  if (error) return res.status(500).json({ error: "Could not load products." });
  res.json({ products: data });
});

// Client sends product IDs and quantities only. Prices are always read from the database.
app.post("/api/checkout/session", requireUser, async (req, res) => {
  let reservedOrderId = null;
  const items = req.body && req.body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ error: "Provide between 1 and 30 cart lines." });
  }
  const normalized = [];
  for (const item of items) {
    if (!item || typeof item.product_id !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      return res.status(400).json({ error: "Each cart line needs a product_id and quantity from 1 to 10." });
    }
    normalized.push({ product_id: item.product_id, quantity: item.quantity });
  }

  try {
    const { data: orderId, error: reserveError } = await supabase.rpc("reserve_inventory_for_order", {
      p_user_id: req.user.id,
      p_items: normalized
    });
    if (reserveError) {
      const status = /stock|inventory|inactive/i.test(reserveError.message) ? 409 : 500;
      return res.status(status).json({ error: status === 409 ? "One or more items are unavailable." : "Could not reserve your order." });
    }

    reservedOrderId = orderId;
    const { data: lines, error: linesError } = await supabase.from("order_items")
      .select("product_id, quantity, unit_price_cents, products(name)")
      .eq("order_id", orderId);
    if (linesError || !lines?.length) throw linesError || new Error("Order has no items.");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      customer_email: req.user.email,
      line_items: lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency,
          unit_amount: line.unit_price_cents,
          product_data: { name: line.products.name }
        }
      })),
      success_url: `${appOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appOrigin}/?checkout=cancelled`,
      metadata: { order_id: orderId, user_id: req.user.id }
    });
    const { error: updateError } = await supabase.from("orders")
      .update({ stripe_session_id: session.id }).eq("id", orderId);
    if (updateError) throw updateError;
    res.json({ checkout_url: session.url });
  } catch (err) {
    if (reservedOrderId) {
      const { error: releaseError } = await supabase.rpc("release_order_reservation", { p_order_id: reservedOrderId });
      if (releaseError) console.error("Could not release failed checkout reservation:", releaseError);
    }
    console.error("Checkout session creation failed:", err);
    res.status(500).json({ error: "Could not start secure checkout." });
  }
});

app.get("/api/orders", requireUser, async (req, res) => {
  const { data, error } = await supabase.from("orders")
    .select("id, status, total_cents, currency, created_at, order_items(product_id, quantity, unit_price_cents, products(name))")
    .eq("user_id", req.user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: "Could not load order history." });
  res.json({ orders: data });
});

app.listen(port, () => console.log(`HALF MAGIC API listening on http://localhost:${port}`));
