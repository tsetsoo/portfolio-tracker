// Test-only stub for the "server-only" marker package.
//
// The real package throws when imported outside of a React Server
// Component build (see node_modules/server-only), which is exactly what
// happens under Vitest's plain Node environment. Aliasing to this no-op
// module lets tests exercise server-only modules (db client, quote
// service, portfolio valuation) without pulling in the Next.js RSC
// bundler condition.
export {};
