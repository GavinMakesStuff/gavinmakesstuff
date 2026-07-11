/* ═══════════════════════════════════════
   scout/js/utils.js
   Supabase config + shared helpers.
   API key is server-side only.
   ═══════════════════════════════════════ */

// ── Supabase config (public — safe to expose) ─────────────────
window.SCOUT_SUPABASE_URL      = 'https://danpqkwdttjqwduhhrbp.supabase.co';
window.SCOUT_SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY_HERE';

// ── Stripe publishable key (public — safe to expose) ──────────
window.SCOUT_STRIPE_PK = 'PASTE_YOUR_STRIPE_PUBLISHABLE_KEY_HERE';

// ── Shared State ──────────────────────────────────────────────
let savedJobs   = JSON.parse(localStorage.getItem('scout-saved')   || '[]');
let appliedJobs = JSON.parse(localStorage.getItem('scout-applied') || '[]');

let userProfile = JSON.parse(localStorage.getItem('scout-profile') || 'null') || {
  role:'', industry:'', salary:'', currency:'USD',
  experience:'', travel:'', certs:'', notes:'', jobGoal:''
};

// ── Currency ──────────────────────────────────────────────────
const CURRENCY_SYMBOLS = {
  USD:'$', CAD:'CA$', EUR:'€', GBP:'£', AUD:'AU$',
  NZD:'NZ$', JPY:'¥', INR:'₹', MXN:'MX$', CHF:'CHF', ZAR:'R'
};
function currencySymbol() { return CURRENCY_SYMBOLS[userProfile.currency] || '$'; }

// ── HTML Escaping ─────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ─────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Theme ─────────────────────────────────────────────────────
function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('scout-theme', isDark ? 'light' : 'dark');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = isDark ? 'ti ti-moon' : 'ti ti-sun';
}

(function applyTheme() {
  const saved = localStorage.getItem('scout-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

// ── Location ──────────────────────────────────────────────────
let userLocation = JSON.parse(localStorage.getItem('scout-location') || 'null');

async function requestUserLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        localStorage.setItem('scout-location', JSON.stringify(userLocation));
        updateLocationBadge();
        resolve(userLocation);
      },
      () => resolve(null)
    );
  });
}

function updateLocationBadge() {
  document.querySelectorAll('.location-badge-el').forEach(el => {
    el.textContent = userLocation ? 'Location saved' : 'Not shared';
    el.style.color = userLocation ? 'var(--green)' : 'var(--text-dim)';
  });
}
