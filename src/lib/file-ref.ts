/** A stored file pointer on a note (`Note.attachments`). The shapes are those
 *  the removed consulting-files module wrote; nothing writes a new one. */
export type FileMeta = { name: string; mime: string; size: number };
export type FileRef =
  | ({ kind: "drive"; fileId: string; webViewLink: string } & FileMeta)
  | ({ kind: "blob"; pathname: string } & FileMeta)
  | ({ kind: "data"; dataUrl: string } & FileMeta);
