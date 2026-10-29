"use client";

import { useState } from "react";

// Límite por envío en Vercel (~4,5 MB). Se deja margen para el resto del formulario.
const MAX_TOTAL = 4 * 1024 * 1024;
const COMPRESS_OVER = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;

/** Reduce fotos pesadas (típicas de cámara) a JPEG de 2000px. Las fotos de WhatsApp suelen pasar sin cambios. */
async function shrink(file: File): Promise<File> {
  if (file.size <= COMPRESS_OVER || !file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    // Se conserva el nombre (para asignar fotos por nombre); solo cambia la extensión si no era JPG.
    const name = /\.jpe?g$/i.test(file.name) ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file; // si el navegador no puede leerla, el servidor dará el error correspondiente
  }
}

export function PhotoInput({ name, required }: { name: string; required?: boolean }) {
  const [info, setInfo] = useState<string | null>(null);
  return (
    <>
      <input
        type="file"
        name={name}
        multiple
        required={required}
        accept="image/jpeg,image/png,image/webp"
        onChange={async (e) => {
          const input = e.currentTarget;
          const files = [...(input.files ?? [])];
          setInfo(files.length ? "Preparando fotos…" : null);
          const out = await Promise.all(files.map(shrink));
          const dt = new DataTransfer();
          out.forEach((f) => dt.items.add(f));
          input.files = dt.files;
          const total = out.reduce((s, f) => s + f.size, 0);
          const mb = (total / 1024 / 1024).toFixed(1);
          const reduced = out.filter((f, i) => f !== files[i]).length;
          if (total > MAX_TOTAL) {
            input.setCustomValidity(`Las fotos suman ${mb} MB y el máximo por envío es 4 MB. Subilas en tandas.`);
            setInfo(`⚠ ${mb} MB: subilas en tandas (máximo 4 MB por envío).`);
          } else {
            input.setCustomValidity("");
            setInfo(files.length ? `${files.length} foto(s), ${mb} MB${reduced ? ` · ${reduced} reducida(s) para subir más rápido` : ""}.` : null);
          }
        }}
      />
      {info && <span className="field-hint">{info}</span>}
    </>
  );
}
