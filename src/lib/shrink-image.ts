// Shrinks a large photo in the browser so it fits a host's upload limit (plan §2.5).

/** Photos of this size or less are sent untouched. */
export const SHRINK_OVER_BYTES = 4 * 1024 * 1024;
const LONG_EDGE = 2000;
const QUALITIES = [0.9, 0.8, 0.65];

type Source = { image: CanvasImageSource; width: number; height: number; close: () => void };

async function readImage(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some browsers decode a format in <img> but not here: try that next.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const element = new Image();
    await new Promise<void>((resolve, reject) => {
      element.onload = () => resolve();
      element.onerror = () => reject(new Error("unreadable image"));
      element.src = url;
    });
    return {
      image: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      close: () => {},
    };
  } finally {
    // The decoded picture stays in the element after the URL is gone.
    URL.revokeObjectURL(url);
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Long edge 2000 px, JPEG quality 0.9 → 0.8 → 0.65 until the file is 4 MB or less.
 * Returns the original file when it is small enough already, when the browser cannot
 * read it (HEIC outside Safari), or when anything fails.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER_BYTES) return file;
  try {
    const source = await readImage(file);
    try {
      if (!source.width || !source.height) return file;
      const scale = Math.min(1, LONG_EDGE / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return file;
      // JPEG has no transparency: without this a transparent PNG turns black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source.image, 0, 0, canvas.width, canvas.height);

      let smallest: Blob | null = null;
      for (const quality of QUALITIES) {
        const blob = await toJpeg(canvas, quality);
        // A browser that cannot write JPEG answers with a PNG: not what we asked for.
        if (!blob || blob.type !== "image/jpeg") return file;
        smallest = blob;
        if (blob.size <= SHRINK_OVER_BYTES) break;
      }
      if (!smallest || smallest.size >= file.size) return file;
      const name = `${file.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
      return new File([smallest], name, { type: "image/jpeg", lastModified: file.lastModified });
    } finally {
      source.close();
    }
  } catch {
    return file;
  }
}
