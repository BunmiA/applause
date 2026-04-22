const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory state ───────────────────────────────────────────────────────────
const state = {
  currentPerformer: null,
  performers: {}, // { [name]: { applause: number } }
};

// ── Per-socket shake rate limiting ────────────────────────────────────────────
const shakeLimits = new Map(); // socketId -> { count, windowStart }
const SHAKE_LIMIT = 15;        // max shakes per window
const SHAKE_WINDOW = 1000;     // 1 second window

function isRateLimited(socketId) {
  const now = Date.now();
  let entry = shakeLimits.get(socketId);

  if (!entry || now - entry.windowStart > SHAKE_WINDOW) {
    shakeLimits.set(socketId, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= SHAKE_LIMIT) return true;
  entry.count++;
  return false;
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json(state);
});

app.post('/api/performer', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });

  state.currentPerformer = trimmed;

  if (!state.performers[trimmed]) {
    state.performers[trimmed] = { applause: 0 };
  }

  io.emit('state_update', state);
  res.json({ success: true });
});

app.post('/api/reset', (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Name is required' });
  }

  const trimmed = name.trim();
  if (state.performers[trimmed]) {
    state.performers[trimmed].applause = 0;
    io.emit('state_update', state);
  }

  res.json({ success: true });
});

app.delete('/api/performer/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);

  if (state.performers[name]) {
    delete state.performers[name];
    if (state.currentPerformer === name) {
      state.currentPerformer = null;
    }
    io.emit('state_update', state);
  }

  res.json({ success: true });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Send full state on connect
  socket.emit('state_update', state);

  socket.on('shake', () => {
    if (!state.currentPerformer) return;
    if (isRateLimited(socket.id)) return;

    state.performers[state.currentPerformer].applause++;
    io.emit('state_update', state);
    // Broadcast a clap event so dashboard can animate
    io.emit('clap', { performer: state.currentPerformer });
  });

  socket.on('disconnect', () => {
    shakeLimits.delete(socket.id);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎉  Applause app running at  http://localhost:${PORT}`);
  console.log(`📱  Mobile clap page:        http://localhost:${PORT}/clap.html\n`);
});
