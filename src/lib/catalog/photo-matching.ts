// Asigna las fotos mencionadas en un mensaje a los archivos subidos junto con él.

export type AttachmentRef = { id: string; filename: string };

export function filenameKey(name: string): string {
  return name.trim().toLowerCase();
}

function stem(name: string): string {
  return filenameKey(name).replace(/\.[a-z0-9]+$/, "");
}

export type PhotoMatch = {
  /** En el orden mencionado en el mensaje; el primero será la portada. */
  matched: { name: string; attachmentId: string; exact: boolean }[];
  /** Nombres mencionados que no se encontraron entre los archivos subidos. */
  missing: string[];
};

export function matchPhotos(names: string[], attachments: AttachmentRef[]): PhotoMatch {
  const matched: PhotoMatch["matched"] = [];
  const missing: string[] = [];
  for (const name of names) {
    const exact = attachments.find((a) => filenameKey(a.filename) === filenameKey(name));
    // Misma base con otra extensión (af1.jpg ↔ af1.jpeg): se acepta, pero se marca para revisar.
    const loose = exact ?? attachments.find((a) => stem(a.filename) === stem(name));
    if (loose && !matched.some((m) => m.attachmentId === loose.id)) matched.push({ name, attachmentId: loose.id, exact: !!exact });
    else if (!loose) missing.push(name);
  }
  return { matched, missing };
}
