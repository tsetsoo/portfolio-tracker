# Portfolio Tracker

Personal net-worth tracker (Next.js + SQLite).

> **Security note:** This app has no authentication or authorization. Anyone
> who can reach it can view and edit your holdings. Run it only on localhost
> or behind your own auth/reverse proxy — do **not** expose it directly to
> the internet.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Tests

```bash
npm test
```

## IBKR

Desktop → Import → upload Flex/Activity trades CSV.
