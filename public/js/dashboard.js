/* global io */
'use strict';

const socket = io();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const performerForm   = document.getElementById('performer-form');
const performerInput  = document.getElementById('performer-input');
const formError       = document.getElementById('form-error');
const liveBadge       = document.getElementById('live-badge');
const performerName   = document.getElementById('performer-name');
const applauseNumber  = document.getElementById('applause-number');
const leaderboardEl   = document.getElementById('leaderboard');
const eqBars          = document.getElementById('eq-bars');
const meterFill       = document.getElementById('meter-fill');
const clapUrl         = document.getElementById('clap-url');

// Set clap page URL
clapUrl.textContent = `${location.origin}/clap.html`;
clapUrl.href        = `${location.origin}/clap.html`;

// ── State ─────────────────────────────────────────────────────────────────────
let prevApplause   = 0;
let eqTimeout      = null;
const MAX_METER    = 500; // claps at which meter is full (scales visually)

// ── Set performer ─────────────────────────────────────────────────────────────
performerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const name = performerInput.value.trim();
  if (!name) return;

  try {
    const res  = await fetch('/api/performer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    performerInput.value = '';
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  }
});

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('state_update', (state) => {
  renderStage(state);
  renderLeaderboard(state);
});

socket.on('clap', () => {
  animateEqualizer();
});

// ── Stage renderer ────────────────────────────────────────────────────────────
function renderStage(state) {
  const { currentPerformer, performers } = state;

  if (currentPerformer) {
    liveBadge.hidden    = false;
    performerName.textContent = currentPerformer;

    const count = performers[currentPerformer]?.applause ?? 0;

    if (count !== prevApplause) {
      applauseNumber.textContent = count.toLocaleString();
      triggerPop(applauseNumber);

      // Animate meter
      const pct = Math.min((count / MAX_METER) * 100, 100);
      meterFill.style.width = `${pct}%`;

      prevApplause = count;
    }
  } else {
    liveBadge.hidden    = true;
    performerName.textContent = '—';
    applauseNumber.textContent = '0';
    meterFill.style.width = '0%';
    prevApplause = 0;
  }
}

// ── Leaderboard renderer ──────────────────────────────────────────────────────
function renderLeaderboard(state) {
  const { currentPerformer, performers } = state;
  const entries = Object.entries(performers)
    .sort(([, a], [, b]) => b.applause - a.applause);

  if (entries.length === 0) {
    leaderboardEl.innerHTML = '<li class="empty-state">No performers yet</li>';
    return;
  }

  leaderboardEl.innerHTML = entries
    .map(([name, data], index) => {
      const rank        = index + 1;
      const rankClass   = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
      const rankSymbol  = rank <= 3 ? ['🥇','🥈','🥉'][rank - 1] : rank;
      const isCurrent   = name === currentPerformer;

      return `
        <li class="performer-item ${isCurrent ? 'is-current' : ''}">
          <span class="performer-rank ${rankClass}">${rankSymbol}</span>
          <span class="performer-item-name" title="${escHtml(name)}">${escHtml(name)}</span>
          ${isCurrent ? '<span class="current-chip">LIVE</span>' : ''}
          <span class="performer-item-count">${data.applause.toLocaleString()} 👏</span>
          <div class="performer-item-actions">
            ${isCurrent ? '' : `<button class="btn btn-ghost" onclick="goLive(${escHtml(JSON.stringify(name))})">Go Live</button>`}
            <button class="btn btn-ghost" onclick="resetPerformer(${escHtml(JSON.stringify(name))})">Reset</button>
            <button class="btn btn-danger" onclick="deletePerformer(${escHtml(JSON.stringify(name))})">✕</button>
          </div>
        </li>
      `;
    })
    .join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────
window.goLive = async (name) => {
  await fetch('/api/performer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  });
};

window.resetPerformer = async (name) => {
  await fetch('/api/reset', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  });
};

window.deletePerformer = async (name) => {
  if (!confirm(`Remove "${name}" from the list?`)) return;
  await fetch(`/api/performer/${encodeURIComponent(name)}`, { method: 'DELETE' });
};

// ── Animations ────────────────────────────────────────────────────────────────
function triggerPop(el) {
  el.classList.remove('pop');
  // Force reflow so the animation restarts
  void el.offsetWidth;
  el.classList.add('pop');
}

const barEls = Array.from(eqBars.querySelectorAll('.eq-bar'));
const heights = [28, 42, 18, 50, 35, 44, 20, 46, 30, 38, 24, 48];

function animateEqualizer() {
  clearTimeout(eqTimeout);

  // Randomise heights
  barEls.forEach((bar, i) => {
    const h = heights[i] + Math.round((Math.random() - 0.5) * 16);
    bar.style.setProperty('--h', `${h}px`);
  });

  eqBars.classList.remove('active');
  void eqBars.offsetWidth; // reflow
  eqBars.classList.add('active');

  eqTimeout = setTimeout(() => eqBars.classList.remove('active'), 600);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
