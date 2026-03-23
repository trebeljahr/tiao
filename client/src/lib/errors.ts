import { toast } from "sonner";
import { ApiError } from "@/lib/api";

export function readableError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

export function isNetworkError(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}

export function toastError(error: unknown) {
  toast.error(readableError(error));
}
