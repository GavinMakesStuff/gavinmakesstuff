/* ═══════════════════════════════════════════════════════
   scout/js/auth.js
   Handles all Supabase auth: signup, magic link login,
   session restore, logout, and tier/balance fetching.
   Loaded before nav.js and jobs.js.
   ═══════════════════════════════════════════════════════ */

// ── Supabase client ───────────────────────────────────────────
const _supa = window.supabase.createClient(
  window.SCOUT_SUPABASE_URL,
  window.SCOUT_SUPABASE_ANON_KEY
);

// ── Session state (populated on load) ────────────────────────
let scoutSession  = null;   // Supabase session object
let scoutUser     = null;   // { id, email, tier, balance, dailyUsed }
let scoutReady    = false;  // true once session check is complete

// ── Init: restore session on page load ───────────────────────
(async function initAuth() {
  const { data: { session } } = await _supa.auth.getSession();
  if (session) {
    scoutSession = session;
    await loadUserProfile(session.user.id);
  }
  scoutReady = true;
  document.dispatchEvent(new CustomEvent('scout:auth-ready'));

  // Listen for auth state changes (magic link callback, logout, etc.)
  _supa.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      scoutSession = session;
      await loadUserProfile(session.user.id);
      document.dispatchEvent(new CustomEvent('scout:signed-in'));
    }
    if (event === 'SIGNED_OUT') {
      scoutSession = null;
      scoutUser    = null;
      document.dispatchEvent(new CustomEvent('scout:signed-out'));
    }
  });
})();

// ── Load profile + balance + daily usage ──────────────────────
async function loadUserProfile(userId) {
  // Fetch profile (tier)
  const { data: profile } = await _supa
    .from('profiles')
    .select('id, email, tier')
    .eq('id', userId)
    .single();

  // Fetch token balance
  const { data: balance } = await _supa
    .from('token_balances')
    .select('balance')
    .eq('user_id', userId)
    .single();

  // Fetch today's usage (free tier)
  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await _supa
    .from('daily_usage')
    .select('analyses_count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .single();

  scoutUser = {
    id:         profile?.id         || userId,
    email:      profile?.email      || '',
    tier:       profile?.tier       || 'free',
    balance:    balance?.balance    || 0,
    dailyUsed:  usage?.analyses_count || 0,
  };
}

// ── Get current JWT for proxy requests ────────────────────────
async function getAuthToken() {
  const { data: { session } } = await _supa.auth.getSession();
  return session?.access_token || null;
}

// ── Sign up with email (magic link) ──────────────────────────
async function signUpWithEmail(email) {
  const { error } = await _supa.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/scout/`,
      shouldCreateUser: true,
    },
  });
  return error ? { error: error.message } : { ok: true };
}

// ── Log in with email (magic link) ───────────────────────────
async function signInWithEmail(email) {
  const { error } = await _supa.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/scout/`,
      shouldCreateUser: false,
    },
  });
  return error ? { error: error.message } : { ok: true };
}

// ── Sign out ──────────────────────────────────────────────────
async function signOut() {
  await _supa.auth.signOut();
  scoutSession = null;
  scoutUser    = null;
  showAuthScreen('login');
}

// ── Refresh user data (called after analysis completes) ───────
async function refreshUserData() {
  if (scoutUser?.id) await loadUserProfile(scoutUser.id);
}

// ── UI helpers ────────────────────────────────────────────────
function showAuthScreen(mode) {
  // mode: 'login' | 'signup'
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  const loginPanel  = document.getElementById('auth-login-panel');
  const signupPanel = document.getElementById('auth-signup-panel');
  if (loginPanel)  loginPanel.style.display  = mode === 'login'  ? 'block' : 'none';
  if (signupPanel) signupPanel.style.display = mode === 'signup' ? 'block' : 'none';

  document.getElementById('auth-email-login')?.focus();
}

function hideAuthScreen() {
  document.getElementById('auth-overlay')?.classList.remove('open');
}

function updateUserUI() {
  if (!scoutUser) return;

  // Email in sidebar footer
  const emailEl = document.getElementById('sb-user-email');
  if (emailEl) emailEl.textContent = scoutUser.email;

  // Tier badge
  const tierEl = document.getElementById('sb-user-tier');
  if (tierEl) {
    tierEl.textContent = scoutUser.tier === 'vip' ? '★ VIP'
                       : scoutUser.tier === 'paid' ? 'Paid'
                       : 'Free';
    tierEl.dataset.tier = scoutUser.tier;
  }

  // Token balance (paid/vip only)
  const balanceEl = document.getElementById('sb-token-balance');
  if (balanceEl) {
    if (scoutUser.tier === 'vip') {
      balanceEl.textContent = '∞ unlimited';
      balanceEl.style.display = 'block';
    } else if (scoutUser.tier === 'paid') {
      balanceEl.textContent = `${scoutUser.balance} tokens`;
      balanceEl.style.display = 'block';
    } else {
      // Free tier: show daily usage
      const remaining = Math.max(0, 2 - scoutUser.dailyUsed);
      balanceEl.textContent = `${remaining}/2 free today`;
      balanceEl.style.display = 'block';
    }
  }

  // Show/hide buy tokens button
  const buyBtn = document.getElementById('sb-buy-tokens-btn');
  if (buyBtn) {
    buyBtn.style.display = scoutUser.tier === 'vip' ? 'none' : 'block';
  }
}

// ── Auth form handlers (called from HTML) ─────────────────────
async function handleSignup() {
  const emailEl = document.getElementById('auth-email-signup');
  const errEl   = document.getElementById('auth-signup-error');
  const btn     = document.getElementById('auth-signup-btn');
  const email   = emailEl?.value.trim();

  if (!email || !email.includes('@')) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Sending…';
  if (errEl) errEl.textContent = '';

  const result = await signUpWithEmail(email);

  if (result.error) {
    if (errEl) errEl.textContent = result.error;
    btn.disabled    = false;
    btn.textContent = 'Create account';
  } else {
    // Show confirmation
    const panel = document.getElementById('auth-signup-panel');
    if (panel) panel.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:2rem;margin-bottom:12px;">📬</div>
        <div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:8px;">Check your inbox</div>
        <div style="font-size:0.85rem;color:var(--text-muted);line-height:1.6;">
          We sent a magic link to <strong>${escHtml(email)}</strong>.<br>
          Click it to verify your email and access Scout.<br><br>
          You can close this window.
        </div>
      </div>`;
  }
}

async function handleLogin() {
  const emailEl = document.getElementById('auth-email-login');
  const errEl   = document.getElementById('auth-login-error');
  const btn     = document.getElementById('auth-login-btn');
  const email   = emailEl?.value.trim();

  if (!email || !email.includes('@')) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Sending…';
  if (errEl) errEl.textContent = '';

  const result = await signInWithEmail(email);

  if (result.error) {
    if (errEl) errEl.textContent = result.error;
    btn.disabled    = false;
    btn.textContent = 'Send magic link';
  } else {
    const panel = document.getElementById('auth-login-panel');
    if (panel) panel.innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:2rem;margin-bottom:12px;">📬</div>
        <div style="font-size:1rem;font-weight:700;color:var(--text);margin-bottom:8px;">Magic link sent</div>
        <div style="font-size:0.85rem;color:var(--text-muted);line-height:1.6;">
          Check your inbox at <strong>${escHtml(email)}</strong>.<br>
          Click the link to sign in — no password needed.
        </div>
      </div>`;
  }
}

// ── Open Stripe checkout ──────────────────────────────────────
async function openCheckout(bundle) {
  // bundle: 'starter' | 'standard' | 'pro'
  if (!scoutSession) { showAuthScreen('login'); return; }

  const token = await getAuthToken();
  const res   = await fetch('/api/scout-checkout', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ bundle }),
  });

  const data = await res.json();
  if (data.url) {
    window.location.href = data.url;
  } else {
    showToast('Checkout failed — please try again.');
  }
}

// ── Listen for auth events ────────────────────────────────────
document.addEventListener('scout:signed-in', () => {
  hideAuthScreen();
  updateUserUI();
  showToast(`Welcome back, ${scoutUser?.email?.split('@')[0] || 'there'}!`);
});

document.addEventListener('scout:signed-out', () => {
  showAuthScreen('login');
});
