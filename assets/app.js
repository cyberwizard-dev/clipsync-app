// ClipSync landing page.
// Plans are loaded from the server (/paystack/quote), which also decides what is charged (naira at today's rate).
// This list is only shown until the quote arrives, or if it fails.
const FALLBACK_PLANS = [
  { id: "dev3_3m", devices: 3, months: 3, period: "3 months", usd: 4.99 },
  { id: "dev3_6m", devices: 3, months: 6, period: "6 months", usd: 8.99 },
  { id: "dev3_12m", devices: 3, months: 12, period: "1 year", usd: 14.99, popular: true },
  { id: "dev5_3m", devices: 5, months: 3, period: "3 months", usd: 6.99 },
  { id: "dev5_6m", devices: 5, months: 6, period: "6 months", usd: 11.99 },
  { id: "dev5_12m", devices: 5, months: 12, period: "1 year", usd: 19.99 },
];

const SUPABASE_URL = "https://msixdmlumwtcvhxnqccn.supabase.co";
const SUPABASE_KEY = "sb_publishable__7TSPCjzdY-wbggHxMsM8Q_UgI17Vqr"; // publishable: public by design


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
  const qtyField = form.querySelector("#f-qty-field");
  const qty = form.querySelector("#f-qty");
  const plansBox = document.getElementById("plans");
  let plans = FALLBACK_PLANS, addon = { usd_per_device: 3.99, ngn_per_device: null, max_quantity: 10 }, tier = 3;
  const usd = (n) => "$" + n.toFixed(2);
  const naira = (n) => "₦" + Math.round(n).toLocaleString("en-NG");
  const qtyValue = () => Math.min(10, Math.max(1, parseInt(qty.value, 10) || 1));

  function renderCards() {
    document.querySelectorAll(".tier-switch button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.tier === tier)));
    plansBox.innerHTML = "";
    for (const p of plans.filter((x) => x.devices === tier)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "plan" + (p.months === 12 ? " plan-best" : "");
      b.dataset.plan = p.id;
      b.innerHTML = (p.months === 12 ? '<span class="plan-badge">Best value</span>' : "") +
        `<span class="plan-name">${p.period}</span>` +
        `<span class="plan-price"><span data-price>${usd(p.usd)}</span><span class="per">${(p.usd / p.months).toFixed(2) === "NaN" ? "" : "≈ " + usd(p.usd / p.months) + " a month"}</span></span>` +
        `<span class="plan-ngn">${p.ngn ? "≈ " + naira(p.ngn) + " today" : ""}</span>` +
        `<span class="plan-desc">Up to ${p.devices} devices in your pairing for ${p.period}.</span>` +
        `<span class="plan-pick">Choose ${p.period}</span>`;
      b.setAttribute("aria-pressed", String(plan.value === p.id));
      b.addEventListener("click", () => {
        plan.value = p.id; onPlanChange();
        form.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        setTimeout(() => email.focus({ preventScroll: true }), 300);
      });
      plansBox.appendChild(b);
    }
  }

  function renderSelect() {
    const keep = plan.value;
    plan.innerHTML = "";
    for (const p of plans) {
      const o = new Option(`${p.devices} devices · ${p.period} · ${usd(p.usd)}${p.ngn ? " (≈ " + naira(p.ngn) + ")" : ""}`, p.id);
      plan.add(o);
    }
    plan.add(new Option(`Extra devices for an existing license · ${usd(addon.usd_per_device)} each`, "addon"));
    plan.value = keep && [...plan.options].some((o) => o.value === keep) ? keep : (plans.find((p) => p.popular) || plans[0]).id;
  }

  function price() {
    if (plan.value === "addon") return addon.ngn_per_device ? Math.ceil(addon.ngn_per_device * qtyValue() / 100) * 100 : null;
    return (plans.find((p) => p.id === plan.value) || {}).ngn || null;
  }
  const payLabel = () => (price() ? "Pay " + naira(price()) + " with Paystack" : "Pay with Paystack");

  function onPlanChange() {
    qtyField.hidden = plan.value !== "addon";
    const p = plans.find((x) => x.id === plan.value);
    if (p && p.devices !== tier) { tier = p.devices; renderCards(); }
    document.querySelectorAll(".plan[data-plan]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.plan === plan.value)));
    if (!submit.disabled) submit.textContent = payLabel();
  }

  document.querySelectorAll(".tier-switch button").forEach((b) => b.addEventListener("click", () => { tier = +b.dataset.tier; renderCards(); }));
  plan.addEventListener("change", onPlanChange);
  qty.addEventListener("input", onPlanChange);
  document.getElementById("addon-link").addEventListener("click", () => { plan.value = "addon"; onPlanChange(); });
  renderSelect(); renderCards(); onPlanChange();

  function show(msg, kind) {
    status.textContent = msg;
    status.className = "status " + (kind || "");
  }

  const MESSAGES = {
    invalid_email: "That email address doesn't look right. Check it and try again.",
    invalid_plan: "Choose a plan, then try again.",
    invalid_quantity: "Choose between 1 and 10 extra devices.",
    too_many_requests: "We've already received several requests from this email. We'll be in touch soon.",
  };

  const FN = SUPABASE_URL + "/functions/v1/paystack";
  const request = document.getElementById("f-request");
  const keybox = document.getElementById("f-key");
  const keyValue = document.getElementById("f-key-value");
  // Plans and today's naira prices from the server (it also decides the amount actually charged).
  fetch(FN + "/quote").then((r) => r.json()).then((q) => {
    if (Array.isArray(q.plans) && q.plans.length) plans = q.plans;
    if (q.addon) addon = q.addon;
    document.getElementById("addon-price").textContent =
      usd(addon.usd_per_device) + " each" + (addon.ngn_per_device ? " (≈ " + naira(addon.ngn_per_device) + ")" : "");
    renderSelect(); renderCards(); onPlanChange();
  }).catch(() => {});

  const MSG_PAY = {
    invalid_email: MESSAGES.invalid_email, invalid_plan: MESSAGES.invalid_plan, invalid_quantity: MESSAGES.invalid_quantity,
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
                                           body: JSON.stringify(plan.value === "addon" ? { email: addr, plan: "addon", quantity: qtyValue() } : { email: addr, plan: plan.value }) });
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
            (r.body.plan === "addon"
              ? `It adds ${r.body.max_devices} extra devices to a pairing that already has a license. `
              : `It covers ${r.body.max_devices} devices; the time starts when you activate it (or after your current period if you're renewing). `) +
            "Enter it in ClipSync: Mac: menu → License… · Windows: tray icon → Enter license key… · Android: Enter license key.";
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
