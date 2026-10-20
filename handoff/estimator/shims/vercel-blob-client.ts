/**
 * Estimator handoff — `@vercel/blob/client` without a server: uploads refuse. The Estimator
 * gets `blobUploads: false`, so its callers take the inline (data-URL) path instead.
 */
export async function upload(pathname: string): Promise<never> {
  throw new Error(`Uploads are not available in the prototype (${pathname})`);
}
