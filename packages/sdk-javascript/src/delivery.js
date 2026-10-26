export class Delivery {
  constructor(endpoint) {
    this.endpoint = endpoint.replace(/\/$/, "") + "/api/captures";
    this.queue = [];
    this.running = false;
    this.sent = 0;
    this.failed = 0;
    this.dropped = 0;
    this.last_error = null;
  }
  submit(capture) {
    try {
      const body = JSON.stringify(capture);
      if (
        this.queue.length >= 32 ||
        new TextEncoder().encode(body).byteLength > 4_000_000
      ) {
        this.dropped++;
        return;
      }
      this.queue.push(body);
      void this.drain();
    } catch {
      this.dropped++;
    }
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const body = this.queue.shift();
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(this.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Horus-Delivery": "automatic",
              },
              body,
              signal: AbortSignal.timeout(2000),
            });
            if (!response.ok) throw Error("Rejected");
            await response.body?.cancel();
            this.sent++;
            this.last_error = null;
            break;
          } catch {
            this.last_error = "Collector unavailable or capture rejected";
            if (attempt === 2) this.failed++;
            else
              await new Promise((resolve) =>
                setTimeout(resolve, 250 * 2 ** attempt),
              );
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
  status() {
    return {
      queued: this.queue.length,
      sent: this.sent,
      failed: this.failed,
      dropped: this.dropped,
      last_error: this.last_error,
    };
  }
  async flush() {
    while (this.running || this.queue.length)
      await new Promise((resolve) => setTimeout(resolve, 10));
    return this.status();
  }
}
const senders = new Map();
export function sender(endpoint) {
  if (!senders.has(endpoint)) {
    if (senders.size >= 4) throw Error("Maximum delivery endpoints reached");
    senders.set(endpoint, new Delivery(endpoint));
  }
  return senders.get(endpoint);
}
