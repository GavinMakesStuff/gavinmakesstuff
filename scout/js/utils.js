/* ═══════════════════════════════════════
   js/utils.js
   Shared state, helpers, theme toggle, location.
   Loaded first — all other JS depends on this.
   ═══════════════════════════════════════ */

// ── Shared State ──────────────────────────
let savedJobs   = JSON.parse(localStorage.getItem('scout-saved')   || '[]');
let appliedJobs = JSON.parse(localStorage.getItem('scout-applied') || '[]');

let userProfile = JSON.parse(localStorage.getItem('scout-profile') || 'null') || {
  role:       '',
  industry:   '',
  salary:     '',
  currency:   'USD',
  experience: '',
  travel:     '',
  certs:      '',
  notes:      '',
  jobGoal:    ''
};


// ── Currency ───────────────────────────────
const CURRENCY_SYMBOLS = {
  USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', AUD: 'AU$',
  NZD: 'NZ$', JPY: '¥', INR: '₹', MXN: 'MX$', CHF: 'CHF', ZAR: 'R'
};

function currencySymbol() {
  return CURRENCY_SYMBOLS[userProfile.currency] || '$';
}


// ── HTML Escaping ─────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


// ── Toast ─────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}


// ── Dark / Light Mode ─────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('theme-btn').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('scout-theme', isDark ? 'light' : 'dark');
}

// Apply saved theme on load
(function () {
  const saved = localStorage.getItem('scout-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    // btn not yet in DOM — jobs.js init will fix the icon
  }
})();


// ── User Location ─────────────────────────
let userLocation = JSON.parse(localStorage.getItem('scout-location') || 'null');

async function requestUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        localStorage.setItem('scout-location', JSON.stringify(userLocation));
        updateLocationBadge();
        resolve(userLocation);
      },
      () => { resolve(null); }
    );
  });
}

function updateLocationBadge() {
  const badge = document.getElementById('location-badge');
  if (!badge) return;
  if (userLocation) {
    badge.textContent = '✓ Location saved, distances will be calculated';
    badge.style.color = 'var(--green)';
  } else {
    badge.textContent = "📍 Not shared, distance won't be calculated";
    badge.style.color = 'var(--text-dim)';
  }
}
