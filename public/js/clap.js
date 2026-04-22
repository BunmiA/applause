/* global io */
'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const nowPlayingName     = document.getElementById('now-playing-name');
const waitingOverlay     = document.getElementById('waiting-overlay');
const permissionPrompt   = document.getElementById('permission-prompt');
const requestPermBtn     = document.getElementById('request-permission-btn');
const clapCircle         = document.getElementById('clap-circle');
const clapInstruction    = document.getElementById('clap-instruction');
const clapTapHint        = document.getElementById('clap-tap-hint');
const rippleLayer        = document.getElementById('ripple-layer');
const myClapsEl          = document.getElementById('my-claps');
const totalClapsEl       = document.getElementById('total-claps');

// ── State ─────────────────────────────────────────────────────────────────────
let currentPerformer = null;
let myClaps          = 0;
let lastClapTime     = 0;
const CLAP_COOLDOWN  = 600; // ms – minimum gap between claps
let gestureMode      = 'shake'; // 'shake' | 'wave'

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io();

socket.on('state_update', (state) => {
  currentPerformer = state.currentPerformer;

  if (currentPerformer) {
    waitingOverlay.style.display = 'none';
    nowPlayingName.textContent   = currentPerformer;
    const count = state.performers[currentPerformer]?.applause ?? 0;
    animateStat(totalClapsEl, count);
  } else {
    waitingOverlay.style.display = '';
    nowPlayingName.textContent   = '—';
    totalClapsEl.textContent     = '0';
  }
});

// ── Sound mode ────────────────────────────────────────────────────────────────
let currentSound = 'claps';

// Pre-load all three audio files with looping enabled
const soundFiles = {
  claps:   new Audio('/sounds/claps.wav'),
  snaps:   new Audio('/sounds/snaps.wav'),
  whistle: new Audio('/sounds/whistle.wav'),
};
Object.values(soundFiles).forEach(a => { a.loop = true; });

document.getElementById('sound-options').addEventListener('click', (e) => {
  const btn = e.target.closest('.sound-btn');
  if (!btn) return;
  // Stop current sound before switching
  stopApplause();
  currentSound = btn.dataset.sound;
  document.querySelectorAll('.sound-btn').forEach(b => b.classList.toggle('active', b === btn));
});

// ── Audio Engine ──────────────────────────────────────────────────────────────
let shakeStopTimer = null;
const SHAKE_STOP_DELAY = 1200; // ms of silence before sound fades out

function startApplause() {
  const audio = soundFiles[currentSound];
  if (!audio) return;
  if (!audio.paused) return; // already playing — keep going
  audio.play().catch(() => {});
}

function stopApplause() {
  Object.values(soundFiles).forEach(a => {
    if (!a.paused) {
      a.pause();
      a.currentTime = 0;
    }
  });
}

function keepApplausePlaying() {
  // Start the sound if not already playing
  startApplause();

  // Reset the stop timer on every shake
  clearTimeout(shakeStopTimer);
  shakeStopTimer = setTimeout(() => stopApplause(), SHAKE_STOP_DELAY);
}

// ── Vibration ─────────────────────────────────────────────────────────────────
function vibrate() {
  if (navigator.vibrate) {
    navigator.vibrate([50, 30, 50]);
  }
}

// ── Mode toggle ───────────────────────────────────────────────────────────────
document.getElementById('mode-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (!btn) return;
  gestureMode = btn.dataset.mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));

  if (gestureMode === 'wave') {
    stopApplause();
    clapInstruction.textContent = 'WAVE TO APPLAUD';
    document.querySelector('.clap-icon').textContent = '🌊';
  } else {
    clapInstruction.textContent = 'SHAKE TO APPLAUD';
    document.querySelector('.clap-icon').textContent = '👏';
  }
});

// ── Clap action ───────────────────────────────────────────────────────────────
function triggerClap() {
  if (!currentPerformer) return;
  if (gestureMode !== 'shake') return;

  const now = Date.now();
  if (now - lastClapTime < CLAP_COOLDOWN) return;
  lastClapTime = now;

  socket.emit('shake');
  myClaps++;
  animateStat(myClapsEl, myClaps);

  vibrate();
  keepApplausePlaying();
  animateCircle();
  spawnRipple();
}

// ── Wave action (silent) ──────────────────────────────────────────────────────
function triggerWave() {
  if (!currentPerformer) return;
  if (gestureMode !== 'wave') return;

  const now = Date.now();
  if (now - lastClapTime < CLAP_COOLDOWN) return;
  lastClapTime = now;

  socket.emit('shake');
  myClaps++;
  animateStat(myClapsEl, myClaps);

  animateCircle();
  spawnRipple();
}

// ── Animations ────────────────────────────────────────────────────────────────
function animateCircle() {
  clapCircle.classList.remove('pulse');
  void clapCircle.offsetWidth; // reflow
  clapCircle.classList.add('pulse');
}

function spawnRipple() {
  const ring = document.createElement('div');
  ring.className = 'ripple-ring';
  rippleLayer.appendChild(ring);
  ring.addEventListener('animationend', () => ring.remove(), { once: true });
}

function animateStat(el, value) {
  el.textContent = value.toLocaleString();
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ── Shake detection ───────────────────────────────────────────────────────────
class ShakeDetector {
  constructor(onShake, threshold = 22) {
    this.onShake    = onShake;
    this.threshold  = threshold;
    this.lastAcc   = { x: null, y: null, z: null };
    this._handler  = this._handleMotion.bind(this);
  }

  _handleMotion(e) {
    const acc = e.accelerationIncludingGravity;
    if (!acc || acc.x == null) return;

    const { x, y, z } = this.lastAcc;

    if (x !== null) {
      const delta = Math.abs(acc.x - x) + Math.abs(acc.y - y) + Math.abs(acc.z - z);
      // Use a higher threshold for shake, lower for wave
      const threshold = gestureMode === 'wave' ? 8 : 22;
      if (delta > threshold) this.onShake();
    }

    this.lastAcc = { x: acc.x, y: acc.y, z: acc.z };
  }

  async start() {
    if (typeof DeviceMotionEvent === 'undefined') {
      return { ok: false, reason: 'unsupported' };
    }

    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const perm = await DeviceMotionEvent.requestPermission();
        if (perm !== 'granted') return { ok: false, reason: 'denied' };
      } catch {
        return { ok: false, reason: 'error' };
      }
    }

    window.addEventListener('devicemotion', this._handler, { passive: true });
    return { ok: true };
  }

  stop() {
    window.removeEventListener('devicemotion', this._handler);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Tap fallback — respects current mode
  clapCircle.addEventListener('click', () => {
    if (gestureMode === 'wave') triggerWave();
    else triggerClap();
  });

  const isMobile  = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const hasMotion = typeof DeviceMotionEvent !== 'undefined';

  if (!isMobile || !hasMotion) {
    // Desktop or no motion sensor — tap only
    clapInstruction.textContent = 'TAP TO APPLAUD';
    clapTapHint.hidden = true;
    return;
  }

  // A single ShakeDetector routes to whichever action is active
  function motionCallback() {
    if (gestureMode === 'wave') triggerWave();
    else triggerClap();
  }

  // iOS needs a button to trigger permission (never show on desktop)
  if (isMobile && typeof DeviceMotionEvent.requestPermission === 'function') {
    permissionPrompt.style.display = 'flex';

    requestPermBtn.addEventListener('click', async () => {
      permissionPrompt.style.display = 'none';
      const detector = new ShakeDetector(motionCallback);
      const result   = await detector.start();

      if (!result.ok) {
        clapInstruction.textContent = 'TAP TO APPLAUD';
        clapTapHint.hidden = true;
      }
    }, { once: true });

    return;
  }

  // Android / non-iOS: start immediately
  const detector = new ShakeDetector(motionCallback);
  const result   = await detector.start();

  if (!result.ok) {
    clapInstruction.textContent = 'TAP TO APPLAUD';
    clapTapHint.hidden = true;
  }
}

init();
