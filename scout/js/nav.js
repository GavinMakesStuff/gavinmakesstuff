/* ═══════════════════════════════════════
   scout/js/nav.js
   Sidebar, view switching, guide, auth state.
   ═══════════════════════════════════════ */

// ── Sidebar collapse ──────────────────────────────────────────
let sidebarCollapsed = localStorage.getItem('scout-sidebar') === 'collapsed';

function initSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  if (sidebarCollapsed) sb.classList.add('collapsed');
  updateCollapseBtn();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sidebarCollapsed = !sidebarCollapsed;
  sb.classList.toggle('collapsed', sidebarCollapsed);
  localStorage.setItem('scout-sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
  updateCollapseBtn();
}

function updateCollapseBtn() {
  const icon = document.getElementById('collapse-icon');
  const btn  = document.getElementById('collapse-btn');
  if (!icon || !btn) return;
  icon.className = sidebarCollapsed
    ? 'ti ti-layout-sidebar-left-expand'
    : 'ti ti-layout-sidebar-left-collapse';
  btn.title = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
}

// ── View switching ────────────────────────────────────────────
let currentView = 'results';

function switchView(view) {
  currentView = view;

  document.querySelectorAll('.sb-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  document.querySelectorAll('.view-panel').forEach(el => {
    el.style.display = el.dataset.view === view ? 'flex' : 'none';
  });

  if (view === 'saved')   renderSaved();
  if (view === 'applied') renderApplied();
}

// ── Profile page ──────────────────────────────────────────────
// Pushes userProfile into the visible form fields. Called both when the
// profile page is opened, and any time userProfile changes while it's
// already open (e.g. right after a resume finishes parsing) — without this
// second call site, the toast/status line would update but the fields on
// screen would silently stay stale until the user navigated away and back.
function populateProfileForm() {
  const f = id => document.getElementById(id);
  if (f('p-name'))       f('p-name').value       = userProfile.name       || '';
  if (f('p-role'))       f('p-role').value       = userProfile.role       || '';
  if (f('p-industry'))   f('p-industry').value   = userProfile.industry   || '';
  if (f('p-salary'))     f('p-salary').value     = userProfile.salary     || '';
  if (f('p-currency'))   f('p-currency').value   = userProfile.currency   || 'USD';
  if (f('p-experience')) f('p-experience').value = userProfile.experience || '';
  if (f('p-travel'))     f('p-travel').value     = userProfile.travel     || '';
  if (f('p-certs'))      f('p-certs').value      = userProfile.certs      || '';
  if (f('p-notes'))      f('p-notes').value      = userProfile.notes      || '';
  if (f('p-jobgoal'))    f('p-jobgoal').value    = userProfile.jobGoal    || '';
  refreshProfileStatus();
  if (typeof loadSkillsUI === 'function') loadSkillsUI();
}

function openProfileEditor() {
  populateProfileForm();
  switchView('profile');
}

function closeProfileEditor() { switchView('results'); }

function refreshProfileStatus() {
  // Note: these are classes, not IDs — the resume/location status elements
  // don't have unique IDs, they're queried by class (querySelectorAll)
  // since there can be more than one on the page.
  document.querySelectorAll('.resume-status-el').forEach(el => {
    if (userProfile.resumeFileName) {
      el.textContent = `📄 ${userProfile.resumeFileName}`;
      el.style.color = 'var(--green)';
    } else {
      el.textContent = 'Not uploaded yet';
      el.style.color = 'var(--text-dim)';
    }
  });
  document.querySelectorAll('.resume-remove-btn').forEach(btn => {
    btn.style.display = userProfile.resumeFileName ? 'flex' : 'none';
  });

  document.querySelectorAll('.location-badge-el').forEach(el => {
    el.textContent = userLocation ? 'Location saved' : 'Not shared';
    el.style.color = userLocation ? 'var(--green)' : 'var(--text-dim)';
  });
}

// ── Guide popup ───────────────────────────────────────────────
function toggleGuide() {
  document.getElementById('guide-overlay')?.classList.toggle('open');
}
function closeGuideOnBackdrop(e) {
  if (e.target === e.currentTarget) toggleGuide();
}

// ── Welcome modal ─────────────────────────────────────────────
function openWelcomeModal() {
  document.getElementById('welcome-modal')?.classList.add('open');
}
function dismissWelcome(markSeen) {
  if (markSeen) localStorage.setItem('scout-welcome-seen', 'true');
  document.getElementById('welcome-modal')?.classList.remove('open');
}
function welcomeGoToProfile() {
  dismissWelcome(true);
  openProfileEditor();
}
function skipWelcomeAndTour() {
  dismissWelcome(true);
  maybeStartTour();
}

// ── First-time interactive tour ──────────────────────────────
// Separate from the welcome modal above — runs once per browser via its
// own localStorage flag, so it also fires for users who already dismissed
// the welcome modal before this feature existed.
function maybeStartTour() {
  if (localStorage.getItem('scout-tour-seen') === 'true') return;
  if (typeof window.driver === 'undefined') return;
  if (typeof renderExampleAnalysis !== 'function') return;
  localStorage.setItem('scout-tour-seen', 'true');
  var driver = window.driver.js.driver;
  var tour = driver({
    showProgress: true,
    allowClose: true,
    // Whichever way the tour ends — finished or closed early — put the
    // detail panel back to normal instead of leaving the fake example up.
    onDestroyed: function () { if (typeof showInlinePaste === 'function') showInlinePaste(); },
    steps: [
      { element: '#sb-item-results', popover: { title: 'Results', description: 'Every posting you analyze shows up here as a scored card, newest first.' } },
      { element: '#inline-paste-area', popover: { title: 'Paste a posting', description: 'Paste the full text of a job posting here. Use "Add another posting" to batch several at once.' } },
      { element: '#analyze-btn', popover: { title: 'Analyze', description: 'This shows exactly how many tokens (or free analyses) the current batch will use before you commit to it — no surprises.' } },
      {
        element: '#demo-score-block',
        onHighlightStarted: function () { renderExampleAnalysis(); },
        popover: { title: 'A quick example', description: "Here's a made-up analysis so you can see what each part means before you spend a real one. The score is a blunt 1–100 read on how good a fit you actually are, not just keyword overlap." },
      },
      { element: '#demo-why-score', popover: { title: 'Why This Score', description: 'A plain-English reason for the number above — what helped it, and what held it back.' } },
      { element: '#demo-lead-with', popover: { title: 'Lead With These', description: 'Your strongest matches for this specific posting — pull straight from here for a cover letter.' } },
      { element: '#demo-red-flags', popover: { title: 'Red Flags', description: 'Things a recruiter would notice about the posting itself in seconds — missing salary, a stale listing, and so on.' } },
      { element: '#demo-keywords', popover: { title: 'Keywords', description: 'Skills and terms pulled from the posting, split into what you already have and what\'s missing from your resume. Click any chip to copy it.' } },
      { element: '#sb-item-profile', popover: { title: 'Your profile', description: 'All of this — the score, the reasoning, the missing keywords — is only as accurate as your profile. Fill in your background, experience, and skills here (or upload a resume to auto-fill it) before analyzing for real.' } },
      { element: '#sb-token-balance', popover: { title: 'Free tier & tokens', description: 'Everyone gets 3 free analyses a week, no card required. Need more? Subscribe for a monthly allowance or buy a one-time token pack — this shows your current balance, always visible here.' } },
      { element: '#sb-item-saved', popover: { title: 'Saved', description: 'Bookmark postings here to come back to later.' } },
      { element: '#sb-item-applied', popover: { title: 'Applied', description: 'Track applications with dates, contacts, and follow-ups once you’ve applied.' } },
      { element: '#sb-item-guide', popover: { title: 'Full guide', description: 'You can reopen the full step-by-step guide here any time.' } },
    ],
  });
  tour.drive();
}

// ── DOMContentLoaded ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();

  // Theme icon
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const icon  = document.getElementById('theme-icon');
  if (icon) icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';

  updateLocationBadge();
});

// ── Auth-ready: decide what to show ──────────────────────────
// auth.js dispatches 'scout:auth-ready' as soon as its session check
// resolves, which can happen before this script has finished loading
// and registered the listener below (script-load race). If that
// happens the event fires into the void and nobody ever shows the
// login screen. Guard against it by also checking the ready-flag
// directly the moment this listener registers, not just listening
// for the event going forward.
function handleAuthReady() {
  if (!scoutSession) {
    // Not logged in — show auth overlay
    showAuthScreen('signup');
  } else {
    // Logged in — update UI and show app
    updateUserUI();
    switchView('results');
    if (localStorage.getItem('scout-welcome-seen') !== 'true') {
      openWelcomeModal();
    } else {
      maybeStartTour();
    }
    // Handle Stripe return
    checkPaymentReturn();
  }
}

document.addEventListener('scout:auth-ready', handleAuthReady);
if (typeof scoutReady !== 'undefined' && scoutReady) {
  handleAuthReady();
}

// ── Handle Stripe success/cancel redirect ─────────────────────
function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);

  if (params.get('payment') === 'success') {
    const tokens = params.get('tokens');
    showToast(`Payment successful! ${tokens} tokens added to your account.`);
    refreshUserData().then(updateUserUI);
    window.history.replaceState({}, '', window.location.pathname);

  } else if (params.get('payment') === 'cancelled') {
    showToast('Payment cancelled.');
    window.history.replaceState({}, '', window.location.pathname);

  } else if (params.get('subscription') === 'success') {
    const plan = params.get('plan');
    showToast(`Subscribed to ${plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'your plan'}!`);
    refreshUserData().then(updateUserUI);
    window.history.replaceState({}, '', window.location.pathname);

  } else if (params.get('subscription') === 'cancelled') {
    showToast('Subscription checkout cancelled.');
    window.history.replaceState({}, '', window.location.pathname);
  }
}
