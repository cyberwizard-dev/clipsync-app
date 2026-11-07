// ClipSync landing page.
// Prices in US dollars, keyed by backend plan id. An empty string hides that plan's price.
// (The form's <select> labels in index.html repeat these prices: update both.)
const PRICES = { month: "$2.99", halfyear: "$14.99", year: "$24.99", lifetime: "$49.99" };

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
    invalid_plan: "Choose Monthly, 6 months, Annual or Lifetime, then try again.",
    too_many_requests: "We've already received several requests from this email. We'll be in touch soon.",
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const addr = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      email.setAttribute("aria-invalid", "true");
      email.focus();
      return show(MESSAGES.invalid_email, "err");
    }
    email.removeAttribute("aria-invalid");
    if (honey.value) return show("Request received. You'll get your license key by email.", "ok"); // bot

    submit.disabled = true;
    submit.textContent = "Sending…";
    show("", "");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/request_license", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_email: addr, p_plan: plan.value, p_note: note.value.trim() || null }),
        signal: ctrl.signal,
      });
      const body = await r.text();
      if (r.ok) {
        show("Request received. You'll get your license key by email.", "ok");
        form.reset();
        markPlan(plan.value);
      } else {
        const code = Object.keys(MESSAGES).find((k) => body.includes(k));
        show(code ? MESSAGES[code] : "Your request wasn't sent: the server returned an error (" + r.status + "). Try again in a few minutes.", "err");
      }
    } catch (err) {
      show(err.name === "AbortError"
        ? "The request timed out. Check your connection and try again."
        : "Your request wasn't sent because you appear to be offline. Check your connection and try again.", "err");
    } finally {
      clearTimeout(t);
      submit.disabled = false;
      submit.textContent = "Request license";
    }
  });
})();
