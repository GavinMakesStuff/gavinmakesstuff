/* ═══════════════════════════════════════
   scout/js/utils.js
   Supabase config + shared helpers.
   API key is server-side only.
   ═══════════════════════════════════════ */

// ── Supabase config (public — safe to expose) ─────────────────
window.SCOUT_SUPABASE_URL      = 'https://danpqkwdttjqwduhhrbp.supabase.co';
window.SCOUT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhbnBxa3dkdHRqcXdkdWhocmJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3Mzk0MTMsImV4cCI6MjA5OTMxNTQxM30.g__YZgpVzlN-Y6hYVREY4yuwlCTiFkYJfrZHH3uzpTQ';

// ── Stripe publishable key (public — safe to expose) ──────────
window.SCOUT_STRIPE_PK = 'pk_live_51TyyPL2Npn4GNwFtSdZu6s3Kl43KwdOmAxm9EfyIiXMqhQh5i0IldzKL784N64oNWUfP0xyqoMNKv0msxtpcZG9300F8gbEQ8y';

// ── Shared State ──────────────────────────────────────────────
let savedJobs   = JSON.parse(localStorage.getItem('scout-saved')   || '[]');
let appliedJobs = JSON.parse(localStorage.getItem('scout-applied') || '[]');

let userProfile = JSON.parse(localStorage.getItem('scout-profile') || 'null') || {
  role:'', industry:'', salary:'', currency:'USD',
  experience:'', travel:'', certs:'', notes:'', jobGoal:''
};

// ── Account-based storage (Supabase) ───────────────────────────
// savedJobs/appliedJobs/userProfile above start from localStorage on script
// load, which stays as a fast/offline-friendly local cache — but the
// account (not the browser) is the real source of truth now, synced via
// these. No-op in local/stub dev mode (no _supa global) or before a
// session exists; localStorage still gets written either way.
async function syncSavedJobs() {
  localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
  if (typeof _supa === 'undefined' || !scoutSession?.user?.id) return;
  const uid = scoutSession.user.id;
  try {
    await _supa.from('scout_saved_jobs').delete().eq('user_id', uid);
    if (savedJobs.length) {
      await _supa.from('scout_saved_jobs').insert(
        savedJobs.map(j => ({ user_id: uid, job_key: jobKey(j), job_data: j }))
      );
    }
  } catch (e) { console.error('[Scout] Failed to sync saved jobs to account:', e); }
}

async function syncAppliedJobs() {
  localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
  if (typeof _supa === 'undefined' || !scoutSession?.user?.id) return;
  const uid = scoutSession.user.id;
  try {
    await _supa.from('scout_applied_jobs').delete().eq('user_id', uid);
    if (appliedJobs.length) {
      await _supa.from('scout_applied_jobs').insert(
        appliedJobs.map(j => ({ user_id: uid, job_key: jobKey(j), job_data: j }))
      );
    }
  } catch (e) { console.error('[Scout] Failed to sync applied jobs to account:', e); }
}

async function syncJobProfile() {
  localStorage.setItem('scout-profile', JSON.stringify(userProfile));
  if (typeof _supa === 'undefined' || !scoutSession?.user?.id) return;
  try {
    await _supa.from('profiles').update({ job_profile: userProfile }).eq('id', scoutSession.user.id);
  } catch (e) { console.error('[Scout] Failed to sync profile to account:', e); }
}

// One-time (per browser) load-or-migrate, called from nav.js once auth
// resolves. If the account already has server-side data, it wins (server
// is the source of truth going forward). If the account is empty but this
// browser has pre-existing local data (from before this feature shipped),
// upload it once so it isn't silently lost.
async function initAccountData() {
  if (typeof _supa === 'undefined' || !scoutSession?.user?.id) return;
  const uid = scoutSession.user.id;
  try {
    const [savedRes, appliedRes, profileRes] = await Promise.all([
      _supa.from('scout_saved_jobs').select('job_data').eq('user_id', uid),
      _supa.from('scout_applied_jobs').select('job_data').eq('user_id', uid),
      _supa.from('profiles').select('job_profile').eq('id', uid).maybeSingle(),
    ]);

    const serverSaved   = (savedRes.data   || []).map(r => r.job_data);
    const serverApplied = (appliedRes.data || []).map(r => r.job_data);
    const serverProfile = profileRes.data?.job_profile || null;

    if (serverSaved.length || serverApplied.length || serverProfile) {
      if (serverSaved.length)   savedJobs   = serverSaved;
      if (serverApplied.length) appliedJobs = serverApplied;
      if (serverProfile)        userProfile = serverProfile;
      localStorage.setItem('scout-saved',   JSON.stringify(savedJobs));
      localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
      localStorage.setItem('scout-profile', JSON.stringify(userProfile));
    } else {
      const hasLocalData = savedJobs.length || appliedJobs.length ||
        !!(userProfile && (userProfile.name || userProfile.role || userProfile.skills?.hardSkills?.length));
      if (hasLocalData) {
        await Promise.all([syncSavedJobs(), syncAppliedJobs(), syncJobProfile()]);
        console.log('[Scout] Migrated local saved/applied/profile data to your account.');
      }
    }

    if (typeof updateBadges === 'function') updateBadges();
    if (typeof currentView !== 'undefined') {
      if (currentView === 'saved'   && typeof renderSaved === 'function')   renderSaved();
      if (currentView === 'applied' && typeof renderApplied === 'function') renderApplied();
    }
    if (typeof populateProfileForm === 'function' && document.getElementById('p-name')) populateProfileForm();
  } catch (e) {
    console.error('[Scout] Failed to load account data, staying on local storage:', e);
  }
}

// ── Currency ──────────────────────────────
const CURRENCY_SYMBOLS = {
  USD:'$', CAD:'CA$', EUR:'€', GBP:'£', AUD:'AU$',
  NZD:'NZ$', JPY:'¥', INR:'₹', MXN:'MX$', CHF:'CHF', ZAR:'R'
};
function currencySymbol() { return CURRENCY_SYMBOLS[userProfile.currency] || '$'; }

// ── HTML Escaping ─────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Safe href — only allow http(s) URLs into href attributes ───
// AI-echoed URLs (companyUrl, postingUrl, etc.) shouldn't be trusted
// as-is; escHtml alone doesn't block a javascript: scheme.
function safeHref(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return escHtml(trimmed);
}

// ── Toast ─────────────────────────────────
let _toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Theme ─────────────────────────────────
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

// ── Location ──────────────────────────────
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
