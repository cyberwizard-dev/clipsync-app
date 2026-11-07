// ClipSync landing page.
// Lifetime licenses in US dollars, keyed by backend plan id (number of devices). An empty string hides a price.
// (The form's <select> labels in index.html repeat these prices: update both. The server's paystack function holds
// the real prices; buyers are charged in naira at today's rate.)
const PRICES = { dev2: "$9.99", dev5: "$19.99", dev10: "$29.99" };

const SUPABASE_URL = "https://msixdmlumwtcvhxnqccn.supabase.co";
const SUPABASE_KEY = "sb_publishable__7TSPCjzdY-wbggHxMsM8Q_UgI17Vqr"; // publishable: public by design

// ---- Prices -----------------------------------------------------------------
document.querySelectorAll("[data-price]").forEach((el) => {
  const price = PRICES[el.dataset.price] || "";
  el.textContent = price;
  if (!price) el.closest(".plan-price").hidden = true;
});

// ---- Live demo: real AES-256-GCM in the browser, same AAD as the apps ----------
(() => {
  const mac = document.getElementById("demo-mac");
  const phone = document.getElementById("demo-phone");
  const wire = document.getElementById("demo-cipher");
  if (!mac || !phone || !wire) return;
  const subtle = window.crypto && window.crypto.subtle;
  let keyPromise = subtle
    ? subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"])
    : null;

  const b64 = (bytes) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };

  async function seal(text) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    if (!keyPromise) return b64(nonce) + "…"; // insecure context (file://): show something plausible
    const key = await keyPromise;
    const ct = new Uint8Array(await subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode("clipsync-v1:text") },
      key, new TextEncoder().encode(text)));
    const out = new Uint8Array(12 + ct.length);
    out.set(nonce); out.set(ct, 12);
    return b64(out);
  }

  let timer = null;
  let seq = 0;
  function send(from, to) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++seq;
      const text = from.value;
      const sealed = text ? await seal(text) : "";
      if (mine !== seq) return;
      wire.textContent = sealed || "…";
      wire.classList.remove("flash"); void wire.offsetWidth; wire.classList.add("flash");
      setTimeout(() => {
        if (mine !== seq) return;
        to.value = text;
        to.classList.remove("arrived"); void to.offsetWidth; to.classList.add("arrived");
      }, 350);
    }, 220);
  }
  mac.addEventListener("input", () => send(mac, phone));
  phone.addEventListener("input", () => send(phone, mac));
  send(mac, phone);
})();

// ---- Plan picker + license request form ----------------------------------------
(() => {
  const form = document.getElementById("license-form");
  if (!form) return;
  const email = form.querySelector("#f-email");
  const plan = form.querySelector("#f-plan");
  const note = form.querySelector("#f-note");
  const honey = form.querySelector("#f-website");
  const submit = form.querySelector("#f-submit");
  const status = form.querySelector("#f-status");
  const cards = document.querySelectorAll(".plan[data-plan]");

  function markPlan(value) {
    cards.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.plan === value)));
  }
  cards.forEach((c) => c.addEventListener("click", () => {
    plan.value = c.dataset.plan;
    markPlan(plan.value);
    form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    setTimeout(() => email.focus({ preventScroll: true }), 300);
  }));
  plan.addEventListener("change", () => markPlan(plan.value));
  markPlan(plan.value);

  function show(msg, kind) {
    status.textContent = msg;
    status.className = "status " + (kind || "");
  }

  const MESSAGES = {
    invalid_email: "That email address doesn't look right. Check it and try again.",
    invalid_plan: "Choose a 2, 5 or 10-device license, then try again.",
    too_many_requests: "We've already received several requests from this email. We'll be in touch soon.",
  };

  const FN = SUPABASE_URL + "/functions/v1/paystack";
  const request = document.getElementById("f-request");
  const keybox = document.getElementById("f-key");
  const keyValue = document.getElementById("f-key-value");
  let ngn = {};
  const naira = (n) => "₦" + Math.round(n).toLocaleString("en-NG");
  const payLabel = () => (ngn[plan.value] ? "Pay " + naira(ngn[plan.value]) + " with Paystack" : "Pay with Paystack");

  // Today's naira prices from the server (the amount actually charged is decided there too).
  fetch(FN + "/quote").then((r) => r.json()).then((q) => {
    for (const [p, v] of Object.entries(q.prices || {})) {
      ngn[p] = v.ngn;
      document.querySelectorAll(`[data-ngn="${p}"]`).forEach((el) => (el.textContent = "≈ " + naira(v.ngn) + " today"));
    }
    submit.textContent = payLabel();
  }).catch(() => {});
  plan.addEventListener("change", () => { if (!submit.disabled) submit.textContent = payLabel(); });

  const MSG_PAY = {
    invalid_email: MESSAGES.invalid_email, invalid_plan: MESSAGES.invalid_plan,
    rate_unavailable: "We couldn't get today's exchange rate. Try again in a minute, or request by email instead.",
    not_configured: "Payments aren't switched on yet. Request by email instead and we'll send your key.",
  };

  function validEmail() {
    const addr = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      email.setAttribute("aria-invalid", "true");
      email.focus();
      show(MESSAGES.invalid_email, "err");
      return null;
    }
    email.removeAttribute("aria-invalid");
    return addr;
  }

  async function call(url, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    } finally { clearTimeout(t); }
  }
  const offline = (err) => err.name === "AbortError"
    ? "The request timed out. Check your connection and try again."
    : "You appear to be offline. Check your connection and try again.";

  // Pay: the server makes the transaction at today's naira price; Paystack's secure page takes the payment and sends
  // the buyer back here with ?reference=…, where we confirm it and show the key.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = validEmail();
    if (!addr || honey.value) return;
    submit.disabled = true; submit.textContent = "Opening Paystack…"; show("", "");
    try {
      const r = await call(FN + "/init", { method: "POST", headers: { "Content-Type": "application/json" },
                                           body: JSON.stringify({ email: addr, plan: plan.value }) });
      if (r.ok && r.body.authorization_url) { location.href = r.body.authorization_url; return; }
      show(MSG_PAY[r.body.error] || "Couldn't start the payment (" + r.status + "). Try again, or request by email instead.", "err");
    } catch (err) { show(offline(err), "err"); }
    submit.disabled = false; submit.textContent = payLabel();
  });

  async function confirmPayment(reference) {
    document.getElementById("pricing").scrollIntoView();
    show("Confirming your payment…", "");
    for (let i = 0; i < 6; i++) {
      try {
        const r = await call(FN + "/verify?reference=" + encodeURIComponent(reference));
        if (r.ok && r.body.key) {
          keyValue.textContent = r.body.key;
          document.getElementById("f-key-help").textContent =
            `It covers ${r.body.max_devices} devices. Enter it in ClipSync: Mac: menu → License… · Windows: tray icon → ` +
            "Enter license key… · Android: Enter license key. Keep it somewhere safe.";
          keybox.hidden = false;
          show("", "");
          history.replaceState(null, "", location.pathname + "#pricing");
          return;
        }
        if (r.status !== 402 && r.status !== 500) break;
      } catch (_) { /* retry */ }
      await new Promise((res) => setTimeout(res, 2500));
    }
    show("We couldn't confirm the payment yet. If you were charged, your key is safe: email thatwebdeveloper1@gmail.com with reference " + reference + " and we'll sort it out.", "err");
  }
  document.getElementById("f-key-copy").addEventListener("click", async (ev) => {
    try { await navigator.clipboard.writeText(keyValue.textContent); ev.target.textContent = "Copied ✓"; } catch (_) {}
  });
  const ref = new URLSearchParams(location.search).get("reference");
  if (ref) confirmPayment(ref);

  // Fallback: request by email (shows up in ClipSync Admin).
  request.addEventListener("click", async () => {
    const addr = validEmail();
    if (!addr) return;
    if (honey.value) return show("Request received. You'll get your license key by email.", "ok");
    request.disabled = true; show("Sending…", "");
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/request_license", {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_email: addr, p_plan: plan.value, p_note: note.value.trim() || null }),
      });
      const body = await r.text();
      if (r.ok) { show("Request received. You'll get your license key by email.", "ok"); note.value = ""; }
      else {
        const code = Object.keys(MESSAGES).find((k) => body.includes(k));
        show(code ? MESSAGES[code] : "Your request wasn't sent (" + r.status + "). Try again in a few minutes.", "err");
      }
    } catch (err) { show(offline(err), "err"); }
    request.disabled = false;
  });
})();
