import { api } from "../api";

/** Upload into the workspace-backed scratch area used by terminal commands. */
export async function uploadFileToTemp(file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload";
  const path = `.projectclibox-uploads/${crypto.randomUUID()}-${safeName}`;
  const result = await api.uploadFile(undefined, path, file);
  return result.path;
}
