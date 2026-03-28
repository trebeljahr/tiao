import { NextFunction, Request, Response } from "express";
import multer, { MulterError } from "multer";

const storage = multer.memoryStorage();

export const MAX_FILE_SIZE = 512 * 1024; // 512KB

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const fileFilter = (
  _: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

export function profilePictureUpload(fieldName: string) {
  const handler = upload.single(fieldName);

  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err: unknown) => {
      if (!err) {
        return next();
      }

      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            code: "FILE_TOO_LARGE",
            message: `File is too large. Maximum size is ${MAX_FILE_SIZE / 1024}KB.`,
          });
        }

        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(415).json({
            code: "UNSUPPORTED_FILE_TYPE",
            message: "Unsupported file type. Only JPEG, PNG, WebP, and GIF images are allowed.",
          });
        }

        return res.status(400).json({
          code: "UPLOAD_ERROR",
          message: "There was a problem with the uploaded file.",
        });
      }

      next(err);
    });
  };
}
