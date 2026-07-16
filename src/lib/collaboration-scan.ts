import net from "net";
import { getAdminConfig } from "@/lib/admin-config";

export type ScanResult = {
  status: "SAFE" | "REJECTED" | "FAILED" | "PENDING_SCAN";
  engine: string;
  detail: string;
};

const CLAMAV_HOST = process.env.CLAMAV_HOST || "clamav";
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT || 3310);

function scanDetail(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function scanConfig() {
  const config = await getAdminConfig().catch(() => null);
  const timeoutSeconds = intInRange(config?.clamavScanTimeoutSeconds, 8, 1, 60);
  return {
    timeoutMs: timeoutSeconds * 1000,
    failStatus: config?.clamavFailClosed ? "FAILED" as const : "PENDING_SCAN" as const,
  };
}

export async function checkClamAvStatus(timeoutSeconds = 2) {
  const timeoutMs = Math.max(500, Math.min(10_000, Math.round(timeoutSeconds * 1000)));
  return new Promise<{ available: boolean; detail: string }>((resolve) => {
    const socket = net.connect({ host: CLAMAV_HOST, port: CLAMAV_PORT });
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (available: boolean, detail: string) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ available, detail: scanDetail(detail).slice(0, 160) || (available ? "متاح" : "غير متاح") });
    };
    socket.setTimeout(timeoutMs, () => finish(false, "timeout"));
    socket.on("error", (error) => finish(false, error.message));
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
      const answer = Buffer.concat(chunks).toString("utf8");
      if (answer.includes("PONG") || answer.includes("OK")) finish(true, answer);
    });
    socket.on("end", () => {
      const answer = Buffer.concat(chunks).toString("utf8");
      finish(answer.includes("PONG") || answer.includes("OK"), answer || "connected");
    });
    socket.on("connect", () => socket.write("zPING\0"));
  });
}

export async function scanBufferWithClamAv(buffer: Buffer): Promise<ScanResult> {
  if (!buffer.length) return { status: "FAILED", engine: "clamav", detail: "empty buffer" };
  const config = await scanConfig();
  return new Promise((resolve) => {
    const socket = net.connect({ host: CLAMAV_HOST, port: CLAMAV_PORT });
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (result: ScanResult) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(config.timeoutMs, () => finish({ status: config.failStatus, engine: "clamav", detail: "scanner unavailable: timeout" }));
    socket.on("error", (error) => finish({ status: config.failStatus, engine: "clamav", detail: `scanner unavailable: ${error.message}` }));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => {
      const answer = scanDetail(Buffer.concat(chunks).toString("utf8"));
      if (answer.includes("FOUND")) finish({ status: "REJECTED", engine: "clamav", detail: answer.trim() });
      else if (answer.includes("OK")) finish({ status: "SAFE", engine: "clamav", detail: answer.trim() });
      else finish({ status: config.failStatus, engine: "clamav", detail: answer.trim() || "scanner unavailable: no response" });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
        const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length));
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
