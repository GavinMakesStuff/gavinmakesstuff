/* ═══════════════════════════════════════
   js/auth-stub.js — LOCAL VERSION ONLY
   Stubs out all auth functions so the app
   works with a direct API key, no Supabase.
   ═══════════════════════════════════════ */

// Fake session/user — always authenticated as VIP locally
let scoutSession = { access_token: 'local' };
let scoutUser    = { id: 'local', email: 'local', tier: 'vip', balance: 999, dailyUsed: 0 };
let scoutReady   = true;

// Auth functions — no-ops locally
async function getAuthToken()     { return 'local'; }
async function signOut()          { showToast('Sign out not available in local mode.'); }
async function refreshUserData()  { return; }
async function loadUserProfile()  { return; }
function updateUserUI()           { return; }
function showAuthScreen()         { return; }
function hideAuthScreen()         { return; }
function handleSignup()           { return; }
function handleLogin()            { return; }
async function openCheckout()     { showToast('Payments not available in local mode.'); }
async function subscribeToPlan()  { showToast('Payments not available in local mode.'); }

// Fire auth-ready immediately so nav.js proceeds
document.addEventListener('DOMContentLoaded', () => {
  document.dispatchEvent(new CustomEvent('scout:auth-ready'));
});
