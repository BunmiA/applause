require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { createClient } = require('redis');
const { RedisStore } = require('connect-redis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── Redis + Session ───────────────────────────────────────────────────────────
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis: too many reconnect attempts, giving up');
        return new Error('Redis reconnect limit reached');
      }
      const delay = Math.min(retries * 200, 3000); // back off up to 3s
      console.warn(`Redis: reconnecting in ${delay}ms (attempt ${retries})...`);
      return delay;
    },
  },
});
redisClient.on('error', (err) => console.error('Redis client error:', err));
redisClient.connect().catch((err) => console.error('Redis connection error:', err));

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
}));

// ── Passport / Google OAuth ───────────────────────────────────────────────────
passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL,
}, (_accessToken, _refreshToken, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  // API requests get 401; page requests redirect to login
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorised' });
  res.redirect('/login');
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => res.redirect('/')
);

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/clap', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'clap.html'));
});

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

app.use(express.json());
// Serve static files but do NOT auto-serve index.html (protected below)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
// Dashboard page – protected
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/state', (req, res) => {
  res.json(state);
});

app.post('/api/performer', requireAuth, (req, res) => {
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

app.post('/api/reset', requireAuth, (req, res) => {
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

app.delete('/api/performer/:name', requireAuth, (req, res) => {
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
