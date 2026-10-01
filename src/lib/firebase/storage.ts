"use client";
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { getClientStorage } from "./client";
import { publicEnv } from "@/config/public-env";

/**
 * Tenant-scoped uploads: restaurants/{restaurantId}/{folder}/{file}. storage.rules independently enforces
 * authentication, membership + role, content type and size; the checks here only give faster feedback.
 */
export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type UploadFolder = "logo" | "menu" | "products" | "qr" | "invoices" | "scratch";

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function validateImage(file: File, maxMb = publicEnv.maxUploadMb): string | null {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) return "Only PNG, JPG, JPEG or WEBP images are allowed.";
  if (file.size > maxMb * 1024 * 1024) return `Image is too large. The maximum is ${maxMb} MB.`;
  return null;
}

export async function uploadTenantImage(restaurantId: string, folder: UploadFolder, file: File, onProgress?: (pct: number) => void): Promise<string> {
  const problem = validateImage(file);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  const r = ref(getClientStorage(), `restaurants/${restaurantId}/${folder}/${id}.${EXT[file.type]}`);
  const task = uploadBytesResumable(r, file, { contentType: file.type, cacheControl: "public,max-age=31536000" });
  await new Promise<void>((resolve, reject) => {
    task.on("state_changed", (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, () => resolve());
  });
  return getDownloadURL(r);
}

export async function deleteByUrl(url: string) {
  try {
    await deleteObject(ref(getClientStorage(), url));
  } catch {
    /* already gone, or not ours */
  }
}
