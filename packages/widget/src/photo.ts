// Visitor photos: shrink a phone camera shot before it goes up. A 12 MP HDR
// JPEG is 4-8 MB and, over a mobile connection, the difference between "sent"
// and "failed". Longest side 1600 px at JPEG 0.85 is plenty for a leak or a
// scratch on a wall and lands around 300-500 KB. EVERY failure path returns the
// original file: shrinking is an optimisation, never a reason to lose a photo.

const MAX_SIDE = 1600;
const QUALITY = 0.85;
/** The server's per-photo ceiling (10 MB); a photo over it after shrinking is refused up front. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export async function preparePhoto(file: File): Promise<File> {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    if (file.type === 'image/gif') return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && file.type === 'image/jpeg') {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'foto';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
