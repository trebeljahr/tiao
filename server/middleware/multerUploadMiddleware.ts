import multer from "multer";

const storage = multer.memoryStorage();

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

const fileFilter = (
  _: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"));
  }
};

export const multerUploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter,
});
