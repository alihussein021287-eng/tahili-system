import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { getSharp, imageOptimizer } from "next/dist/server/image-optimizer";
import { defaultConfig } from "next/dist/server/config-shared";

const { gte } = require("semver");
const images: Record<string, Buffer> = {};
beforeAll(async () => {
  // Valid synthetic pixels only; no exploit or malformed image payloads.
  const pixel = { create: { width: 4, height: 4, channels: 3 as const, background: "#2468ac" } };
  images.png = await sharp(pixel).png().toBuffer();
  images.jpeg = await sharp(pixel).jpeg().toBuffer();
  images.avif = await sharp(pixel).avif().toBuffer();
});

describe("Next image security patch compatibility", () => {
  it.each(["png", "jpeg", "avif"] as const)("preserves ordinary %s image optimization", async (kind) => {
    const result = await imageOptimizer(
      { buffer: images[kind], contentType: `image/${kind}`, cacheControl: "public, max-age=60", etag: "synthetic" },
      { href: "/synthetic-image", width: 2, quality: 75, mimeType: "image/webp" },
      defaultConfig,
      { isDev: false, silent: true },
    );
    expect(result.contentType).toBe("image/webp");
    expect(result.error).toBeUndefined();
    expect((await sharp(result.buffer).metadata()).width).toBe(2);
  });

  it("uses patched native decoders when Next enables AVIF and SVG", () => {
    // Next 16.3.6 enables AVIF again: a stale root sharp override must not restore vulnerable native code.
    const versions = getSharp(undefined, undefined).versions;
    expect(gte(versions.sharp, "0.35.5")).toBe(true);
    expect(gte(versions.heif, "1.23.2")).toBe(true);
    expect(gte(versions.rsvg, "2.63.2")).toBe(true);
  });
});
