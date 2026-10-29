import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { db } from "@/server/db";
import { getStorage } from "@/server/storage";

// Originales: solo administradores. Versiones optimizadas: públicas únicamente si la
// foto está autorizada y el producto está publicado; si no, solo administradores.
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  const img = await db.productImage.findFirst({
    where: { OR: [{ originalKey: key }, { optimizedKey: key }, { thumbKey: key }] },
    include: { product: { select: { publicationStatus: true } } },
  });
  if (!img) return new NextResponse("No encontrado", { status: 404 });

  const isOriginal = img.originalKey === key;
  const isPublic = !isOriginal && img.authorizedForPublication && !img.deletedAt && img.product.publicationStatus === "PUBLISHED";
  if (!isPublic) {
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return new NextResponse("No autorizado", { status: 401 });
  }
  const data = await getStorage().get(key);
  if (!data) return new NextResponse("Archivo no disponible", { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": isOriginal ? img.mimeType : "image/webp",
      "Cache-Control": isPublic ? "public, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
