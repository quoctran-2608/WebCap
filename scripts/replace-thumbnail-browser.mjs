import { readFile, writeFile } from "node:fs/promises";

const path = "src/editor/thumbnail-service.ts";
const content = await readFile(path, "utf8");
const before = `const browserEnvironment: ThumbnailEnvironment = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("PDF thumbnail canvas is unavailable.");
    return {
      width,
      height,
      fillWhite() {
        context.save();
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.restore();
      },
      drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      ) {
        context.drawImage(
          image.source,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destinationX,
          destinationY,
          destinationWidth,
          destinationHeight,
        );
      },
      encodeJpeg(quality) {
        return new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) =>
              blob === null ? reject(new Error("PDF thumbnail encoding failed.")) : resolve(blob),
            "image/jpeg",
            quality,
          );
        });
      },
      release() {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
};`;
const after = `const browserEnvironment: ThumbnailEnvironment = {
  async decode(blob) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("PDF thumbnail source image could not be decoded."));
        image.src = url;
      });
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        source: image,
        close() {
          image.src = "";
          URL.revokeObjectURL(url);
        },
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  },
  createCanvas(width, height) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("PDF thumbnail canvas is unavailable.");
    return {
      width,
      height,
      fillWhite() {
        context.save();
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.restore();
      },
      drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        destinationX,
        destinationY,
        destinationWidth,
        destinationHeight,
      ) {
        context.drawImage(
          image.source,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destinationX,
          destinationY,
          destinationWidth,
          destinationHeight,
        );
      },
      encodeJpeg: (quality) => canvas.convertToBlob({ type: "image/jpeg", quality }),
      release() {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  },
};`;

if (!content.includes(before)) {
  throw new Error("Expected thumbnail browser renderer was not found.");
}
await writeFile(path, content.replace(before, after));
