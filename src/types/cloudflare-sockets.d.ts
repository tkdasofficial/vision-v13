// Minimal typing for the Cloudflare Workers sockets API used by the SMTP sender.
declare module "cloudflare:sockets" {
  export interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    close(): Promise<void>;
  }
  export function connect(address: string, options?: { secureTransport?: "on" | "off" | "starttls" }): Socket;
}
