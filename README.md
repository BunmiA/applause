# 👏 Applause

A real-time audience applause app. Audience members shake their phone to clap for a live performer — the dashboard shows the count update instantly.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Redis](https://redis.io/) running locally
- A [Google OAuth 2.0](https://console.cloud.google.com/apis/credentials) client ID & secret

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example and fill in your values:

```bash
cp .env .env.local
```

Edit `.env` with your credentials:

```dotenv
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=<random string — generate one below>
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Configure Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create a project → **APIs & Services** → **Credentials** → **Create OAuth 2.0 Client ID**
2. Application type: **Web application**
3. Add these entries:

| Field | Value |
|---|---|
| Authorised JavaScript origins | `http://localhost:3000` |
| Authorised redirect URIs | `http://localhost:3000/auth/google/callback` |

4. Copy the **Client ID** and **Client secret** into your `.env`

### 4. Start Redis

```bash
# macOS with Homebrew
brew services start redis
```

---

## Running

### Development (auto-restarts on file change)

```bash
npm run dev
```

### Production

```bash
npm start
```

App will be available at:

| URL | Description |
|---|---|
| `http://localhost:3000` | Dashboard (requires Google login) |
| `http://localhost:3000/clap.html` | Audience clap page (public) |

---

## Docker

Build and run with Docker:

```bash
docker build -t applause .
docker run -p 3000:8080 \
  -e GOOGLE_CLIENT_ID=... \
  -e GOOGLE_CLIENT_SECRET=... \
  -e GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback \
  -e SESSION_SECRET=... \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  applause
```

---

## How it works

1. The host opens the **dashboard** at `/` and logs in with Google
2. They enter a performer name to go live
3. Audience members open `/clap.html` on their phones and shake to clap
4. The dashboard updates in real time via WebSockets (Socket.IO)
5. All admin actions (set performer, reset, delete) require an authenticated session
