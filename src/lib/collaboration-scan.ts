import net from "net";

export type ScanResult = {
  status: "SAFE" | "REJECTED" | "FAILED";
  engine: string;
  detail: string;
};

const CLAMAV_HOST = process.env.CLAMAV_HOST || "clamav";
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT || 3310);

export async function scanBufferWithClamAv(buffer: Buffer): Promise<ScanResult> {
  if (!buffer.length) return { status: "FAILED", engine: "clamav", detail: "empty buffer" };
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
    socket.setTimeout(Number(process.env.CLAMAV_TIMEOUT_MS || 8000), () => finish({ status: "FAILED", engine: "clamav", detail: "timeout" }));
    socket.on("error", (error) => finish({ status: "FAILED", engine: "clamav", detail: error.message }));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => {
      const answer = Buffer.concat(chunks).toString("utf8");
      if (answer.includes("FOUND")) finish({ status: "REJECTED", engine: "clamav", detail: answer.trim() });
      else if (answer.includes("OK")) finish({ status: "SAFE", engine: "clamav", detail: answer.trim() });
      else finish({ status: "FAILED", engine: "clamav", detail: answer.trim() || "no response" });
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
