// @ts-ignore - qrcode ships without bundled type declarations
import QRCode from "qrcode";

// يولّد رمز QR كـ SVG محلياً (بدون أي خدمة خارجية / بدون إنترنت)
export async function qrSvg(data: string): Promise<string> {
  try {
    let svg: string = await QRCode.toString(data, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    // إزالة width/height الثابتة ليتجاوب الرمز مع حجم الحاوية
    svg = svg.replace(/\s(width|height)="[^"]*"/g, "").replace("<svg ", '<svg style="width:100%;height:100%" ');
    return svg;
  } catch {
    return "";
  }
}
