/**
 * Estimator handoff — browser implementation of src/app/(app)/estimator/client-package-actions.ts
 * (the Client package tab's datasheet rows), type-enforced against the original.
 *
 * The rows come from the part documents (datasheet / spec sheet / manual per printed catalog part —
 * specPackageDocs, the client package's coverage rule). The slice carries no part documents, so the
 * answer is the original's empty success: no rows, nothing truncated — the tab then lists no datasheets.
 * Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/client-package-actions";
import type { Impl as ImplOf } from "./util";

export const CLIENT_PACKAGE_ACTIONS_KEY = "src/app/(app)/estimator/client-package-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;

export function clientPackageActions(): { [K in keyof A]: Impl<K> } {
  const clientPackageDocsAction: Impl<"clientPackageDocsAction"> = async () => ({ ok: true, rows: [], truncated: 0 });
  return { clientPackageDocsAction };
}
