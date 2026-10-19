// Test stand-in for the Workers-only socket module.
export function connect(): never { throw new Error("cloudflare:sockets is not available in tests"); }
