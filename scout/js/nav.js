/* ═══════════════════════════════════════
   js/nav.js — Sidebar, views, guide, welcome
   ═══════════════════════════════════════ */

// ── Sidebar ───────────────────────────────
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

// ── View switching ────────────────────────
let currentView = 'results';

function switchView(view) {
  currentView = view;

  // Update active state on all sidebar items that have data-view
  document.querySelectorAll('.sb-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  // Show/hide main panels
  document.querySelectorAll('.view-panel').forEach(el => {
    el.style.display = el.dataset.view === view ? 'flex' : 'none';
  });

  if (view === 'saved')   renderSaved();
  if (view === 'applied') renderApplied();
}

// ── Guide popup ───────────────────────────
function toggleGuide() {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;
  overlay.classList.toggle('open');
}

function closeGuideOnBackdrop(e) {
  if (e.target === e.currentTarget) toggleGuide();
}

// ── Profile page ──────────────────────────
function openProfileEditor() {
  // Populate fields from current profile
  const f = id => document.getElementById(id);
  if (f('p-role'))       f('p-role').value       = userProfile.role       || '';
  if (f('p-industry'))   f('p-industry').value   = userProfile.industry   || '';
  if (f('p-salary'))     f('p-salary').value     = userProfile.salary     || '';
  if (f('p-currency'))   f('p-currency').value   = userProfile.currency   || 'USD';
  if (f('p-experience')) f('p-experience').value = userProfile.experience || '';
  if (f('p-travel'))     f('p-travel').value     = userProfile.travel     || '';
  if (f('p-certs'))      f('p-certs').value      = userProfile.certs      || '';
  if (f('p-notes'))      f('p-notes').value      = userProfile.notes      || '';
  if (f('p-jobgoal'))    f('p-jobgoal').value    = userProfile.jobGoal    || '';

  // Refresh status indicators
  refreshProfileStatus();

  // Switch to profile view — this also sets the sidebar active bar
  switchView('profile');
}

function closeProfileEditor() {
  switchView('results');
}
function refreshProfileStatus() {
  const resumeStatus = document.getElementById('profile-resume-status');
  const locStatus    = document.getElementById('profile-location-status');
  if (resumeStatus) {
    const hasProfile = !!(userProfile.role || userProfile.industry || userProfile.certs);
    resumeStatus.textContent = hasProfile ? 'Profile data loaded' : 'Not uploaded yet';
    resumeStatus.style.color = hasProfile ? 'var(--green)' : 'var(--text-dim)';
  }
  if (locStatus) {
    locStatus.textContent = userLocation ? 'Location saved' : 'Not shared';
    locStatus.style.color = userLocation ? 'var(--green)' : 'var(--text-dim)';
  }
}

// ── Welcome modal ─────────────────────────
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

// ── Init ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();

  // Theme icon
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const icon  = document.getElementById('theme-icon');
  if (icon) icon.className = theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon';

  // Start on results view
  switchView('results');

  // Welcome modal on first visit
  if (localStorage.getItem('scout-welcome-seen') !== 'true') {
    openWelcomeModal();
  }

  // Update location badges
  updateLocationBadge();
});
