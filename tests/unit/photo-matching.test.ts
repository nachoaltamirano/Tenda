import { describe, expect, it } from "vitest";
import { matchPhotos } from "@/lib/catalog/photo-matching";

const files = [
  { id: "a", filename: "IMG-20261029-WA0012.jpg" },
  { id: "b", filename: "AF1_negra.JPEG" },
  { id: "c", filename: "campus.png" },
];

describe("asignación de fotos por nombre de archivo", () => {
  it("respeta el orden del mensaje y no distingue mayúsculas", () => {
    const r = matchPhotos(["img-20261029-wa0012.JPG", "campus.png"], files);
    expect(r.matched.map((m) => m.attachmentId)).toEqual(["a", "c"]);
    expect(r.matched.every((m) => m.exact)).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("acepta otra extensión marcándolo como no exacto", () => {
    expect(matchPhotos(["af1_negra.jpg"], files).matched[0]).toEqual({ name: "af1_negra.jpg", attachmentId: "b", exact: false });
  });
  it("informa los archivos que faltan", () => {
    expect(matchPhotos(["otra.jpg", "campus.png"], files)).toEqual({
      matched: [{ name: "campus.png", attachmentId: "c", exact: true }],
      missing: ["otra.jpg"],
    });
  });
  it("no asigna dos veces el mismo archivo", () => {
    expect(matchPhotos(["campus.png", "CAMPUS.png"], files).matched).toHaveLength(1);
  });
});
