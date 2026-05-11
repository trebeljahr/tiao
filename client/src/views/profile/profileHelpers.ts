export const PROFILE_PIC_SIZE = 512;
export const PROFILE_PIC_QUALITY = 0.85;

export function resizeImage(
  file: File,
  errorMessages: { failedToResize: string; failedToLoad: string },
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const size = Math.min(width, height);
      const sx = (width - size) / 2;
      const sy = (height - size) / 2;

      const canvas = document.createElement("canvas");
      canvas.width = PROFILE_PIC_SIZE;
      canvas.height = PROFILE_PIC_SIZE;
      // biome-ignore lint/style/noNonNullAssertion: 2d context is always available in browsers we ship to
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, size, size, 0, 0, PROFILE_PIC_SIZE, PROFILE_PIC_SIZE);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error(errorMessages.failedToResize));
            return;
          }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        PROFILE_PIC_QUALITY,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(errorMessages.failedToLoad));
    };

    img.src = url;
  });
}

export function formatTimestamp(value: string | undefined, justNowLabel: string, locale?: string) {
  if (!value) {
    return justNowLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
