(() => {
  const cfg = window.HM_CONFIG || {};
  const ready = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("YOUR_PROJECT") && !cfg.supabaseAnonKey.includes("YOUR_SUPABASE"));
  const money = cents => "$" + (Number(cents) / 100).toFixed(2);
  let client = null;
  let session = null;
  let productsPromise = null;

  function notify(message) {
    if (typeof window.toast === "function") window.toast(message);
    else alert(message);
  }
  function showShell(title, body) {
    let root = document.getElementById("hm-page");
    if (!root) {
      root = document.createElement("div");
      root.id = "hm-page";
      document.body.appendChild(root);
    }
    root.innerHTML = '<div class="hm-shell"><div class="hm-top"><a class="logo" href="#" onclick="closePage();return false">HALF<span>✳</span>MAGIC</a><span>' + title + '</span><button class="hm-close" onclick="closePage()">✕ CLOSE</button></div>' + body + '</div>';
    root.style.display = "block";
    document.body.style.overflow = "hidden";
  }
  function statusMarkup(message) {
    return '<p class="sub hm-commerce-status" role="status">' + message + '</p>';
  }
  async function getProducts() {
    if (!productsPromise) productsPromise = fetch("/api/products").then(async r => {
      if (!r.ok) throw new Error("Could not load store products. Check the database setup.");
      const data = await r.json();
      return data.products || [];
    });
    return productsPromise;
  }
  async function accessToken() {
    if (!client) throw new Error("Connect Supabase first by creating config.js from config.js.example.");
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    return session && session.access_token;
  }
  function currentCart() {
    try { return JSON.parse(localStorage.getItem("hm-cart") || "[]"); }
    catch (_) { return Array.isArray(window.cart) ? window.cart : []; }
  }
  function setAccountLabel(user) {
    if (user) localStorage.setItem("hm-user", JSON.stringify({
      name: user.user_metadata?.name || (user.email || "").split("@")[0],
      email: user.email
    }));
    else localStorage.removeItem("hm-user");
  }

  // Supabase replaces the browser-only demo account handlers.
  window.loginHM = async event => {
    event.preventDefault();
    if (!client) return notify("Supabase is not configured yet. Add config.js first.");
    const form = event.target;
    const email = form.querySelector('input[type="email"]').value.trim();
    const password = form.querySelector('input[type="password"]').value;
    const button = form.querySelector('button[type="submit"],button:not([type])');
    if (button) { button.disabled = true; button.textContent = "SIGNING IN…"; }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (button) { button.disabled = false; button.textContent = "LOG IN ↗"; }
      return notify(error.message);
    }
    session = data.session;
    setAccountLabel(data.user);
    window.openPage("account");
    notify("Welcome back ✳");
  };

  window.signupHM = async event => {
    event.preventDefault();
    if (!client) return notify("Supabase is not configured yet. Add config.js first.");
    const form = event.target;
    const inputs = form.querySelectorAll("input");
    const name = inputs[0].value.trim();
    const email = inputs[1].value.trim();
    const password = inputs[2].value;
    const button = form.querySelector("button");
    if (button) { button.disabled = true; button.textContent = "CREATING ACCOUNT…"; }
    const { data, error } = await client.auth.signUp({
      email, password, options: { data: { name } }
    });
    if (error) {
      if (button) { button.disabled = false; button.textContent = "CREATE ACCOUNT ↗"; }
      return notify(error.message);
    }
    if (data.session) {
      session = data.session;
      setAccountLabel(data.user);
      window.openPage("account");
      notify("Your HALF MAGIC account is ready ✳");
    } else {
      notify("Check your inbox to confirm your email, then log in.");
      window.accountTab("login");
    }
  };

  window.logoutHM = async () => {
    if (client) {
      const { error } = await client.auth.signOut();
      if (error) return notify(error.message);
    }
    session = null;
    setAccountLabel(null);
    window.openPage("account");
  };

  // Replace demo checkout with Stripe-hosted Checkout. The server resolves prices and stock.
  const baseOpenPage = window.openPage;
  window.openPage = function(page, arg) {
    if (page === "checkout") {
      renderCheckout();
      return;
    }
    if (page === "orders") {
      renderOrders();
      return;
    }
    if (page === "account") {
      renderAccount();
      return;
    }
    return baseOpenPage(page, arg);
  };

  async function renderCheckout() {
    const cart = currentCart();
    if (!cart.length) {
      window.openPage("cart");
      return;
    }
    showShell("CHECKOUT / SECURE YOUR MAGIC",
      '<div class="hm-narrow"><div class="eyebrow">01 / YOUR BAG</div><h1>READY TO PLAY?</h1>' +
      '<p class="sub">You will complete payment on Stripe’s secure checkout page. Final prices and stock are verified by the store server.</p>' +
      '<div id="hm-checkout-summary"></div><button id="hm-stripe-checkout" class="limebtn">CONTINUE TO SECURE PAYMENT ↗</button>' +
      '<p class="sub" style="font-size:10px">Test mode only until your Stripe account and webhook are configured.</p></div>');
    const summary = document.getElementById("hm-checkout-summary");
    summary.innerHTML = cart.map(item => '<div class="hm-line"><div class="hm-thumb">✳</div><div style="flex:1"><b>' +
      String(item.name).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])) +
      '</b><small>' + (item.shade || "HALF MAGIC") + '</small></div><b>' + money(Math.round(Number(item.price) * 100)) + '</b></div>').join("");
    document.getElementById("hm-stripe-checkout").onclick = startStripeCheckout;
  }

  async function startStripeCheckout() {
    const button = document.getElementById("hm-stripe-checkout");
    if (!button) return;
    button.disabled = true;
    button.textContent = "PREPARING SECURE CHECKOUT…";
    try {
      const token = await accessToken();
      if (!token) {
        window.openPage("account");
        window.accountTab("login");
        throw new Error("Please sign in before checkout.");
      }
      const cart = currentCart();
      const products = await getProducts();
      const normalized = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const payload = [];
      for (const item of cart) {
        const product = products.find(p => normalized(p.name) === normalized(item.name));
        if (!product) throw new Error('“' + item.name + '” is not connected to an active database product. Add the matching product in Supabase first.');
        const existing = payload.find(x => x.product_id === product.id);
        if (existing) existing.quantity += 1;
        else payload.push({ product_id: product.id, quantity: 1 });
      }
      const response = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ items: payload })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start checkout.");
      if (!result.checkout_url || !/^https:\/\/checkout\.stripe\.com\//.test(result.checkout_url)) {
        throw new Error("The server returned an invalid Stripe Checkout URL.");
      }
      window.location.assign(result.checkout_url);
    } catch (error) {
      notify(error.message || "Checkout could not be started.");
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "TRY AGAIN ↗";
      }
    }
  }

  async function renderAccount() {
    let user = session?.user || null;
    if (!user && client) {
      try {
        const { data } = await client.auth.getSession();
        session = data.session;
        user = session?.user || null;
      } catch (_) {}
    }
    if (user) {
      const displayName = user.user_metadata?.name || (user.email || "").split("@")[0];
      showShell("YOUR HALF MAGIC / ACCOUNT", '<div class="hm-narrow"><div class="eyebrow">MEMBER SPACE</div><h1>HEY, ' +
        displayName.toUpperCase().replace(/[&<>"]/g, "") + '.</h1><p class="sub">' + user.email +
        '</p><button class="pill" onclick="logoutHM()">SIGN OUT</button><div class="hm-detail"><h3>ORDER HISTORY</h3><button class="limebtn" onclick="openPage(\'orders\')">VIEW ORDER HISTORY ↗</button></div></div>');
      return;
    }
    showShell("YOUR HALF MAGIC / ACCOUNT", '<div class="hm-narrow"><div class="eyebrow">MEMBER SPACE</div><h1>COME ON IN.</h1><div class="hm-tabs"><button class="pill" onclick="accountTab(\'login\')">LOG IN</button><button class="pill" onclick="accountTab(\'signup\')">CREATE ACCOUNT</button></div><div id="hm-auth"><form class="hm-authform" onsubmit="loginHM(event)"><input required type="email" placeholder="Email address"><input required type="password" placeholder="Password"><button class="limebtn" type="submit">LOG IN ↗</button></form></div><p class="sub">Your account is securely managed by Supabase Auth.</p></div>');
  }

  async function renderOrders() {
    showShell("ORDER HISTORY / YOUR JOURNEY", '<div class="hm-narrow"><div class="eyebrow">THE GOOD STUFF YOU ORDERED</div><h1>YOUR ORDERS.</h1><div id="hm-orders-content">' + statusMarkup("Loading your orders…") + '</div></div>');
    const target = document.getElementById("hm-orders-content");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Sign in to view your order history.");
      const response = await fetch("/api/orders", { headers: { "Authorization": "Bearer " + token } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load orders.");
      if (!result.orders.length) {
        target.innerHTML = '<p class="sub">No orders yet. Your next favorite is waiting.</p>';
        return;
      }
      target.innerHTML = result.orders.map(order =>
        '<div class="hm-order"><div><b>ORDER #' + order.id.slice(0, 8).toUpperCase() +
        '</b><small>' + new Date(order.created_at).toLocaleDateString() + ' · ' + order.status.toUpperCase() +
        '</small></div><b>' + money(order.total_cents) + '</b></div>'
      ).join("");
    } catch (error) {
      target.innerHTML = statusMarkup(error.message);
    }
  }

  function handleCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("checkout");
    if (!state) return;
    if (state === "success") {
      showShell("PAYMENT / THANK YOU", '<div class="hm-narrow" style="text-align:center"><div style="font-size:70px;color:var(--lime)">✳</div><h1>THANK YOU.</h1><p class="sub">Stripe has returned you to HALF MAGIC. Your order status will update after the signed payment webhook is processed.</p><button class="limebtn" onclick="closePage();openPage(\'orders\')">VIEW MY ORDERS ↗</button></div>');
      localStorage.removeItem("hm-cart");
      window.cart = [];
      ["bagCount","cartNum"].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = "0"; });
    } else if (state === "cancelled") {
      showShell("CHECKOUT / NOT FINISHED", '<div class="hm-narrow"><h1>NO PRESSURE.</h1><p class="sub">Your payment was not completed. Your bag is still here.</p><button class="limebtn" onclick="closePage();openPage(\'cart\')">BACK TO YOUR BAG ↗</button></div>');
    }
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
  }

  if (ready && window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    client.auth.getSession().then(({ data }) => {
      session = data.session;
      if (session?.user) setAccountLabel(session.user);
    });
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (nextSession?.user) setAccountLabel(nextSession.user);
      else setAccountLabel(null);
    });
  }

  const css = document.createElement("style");
  css.textContent = '.hm-commerce-status{padding:14px;border:1px solid #555;background:#151515}.hm-order{display:flex;align-items:center;justify-content:space-between;gap:15px;border-bottom:1px solid #333;padding:20px 0;font-size:12px}.hm-order small{display:block;color:#aaa;margin-top:6px}#hm-stripe-checkout:disabled{opacity:.55;cursor:wait}';
  document.head.appendChild(css);

  window.addEventListener("DOMContentLoaded", handleCheckoutReturn);
  if (document.readyState !== "loading") handleCheckoutReturn();

  if (!ready) console.warn("HALF MAGIC: create config.js from config.js.example to enable Supabase Auth.");
  window.HM_COMMERCE = { isConfigured: () => Boolean(client), refreshProducts: () => { productsPromise = null; return getProducts(); } };
})();
