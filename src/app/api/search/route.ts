import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { globalSearch } from "@/lib/search/global-search";

/**
 * Global nav search (⌘K). The search itself lives in
 * src/lib/search/global-search.ts (shared with Ask AI's `search` tool); the
 * route owns the auth check and the response shape.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const groups = await globalSearch(new URL(req.url).searchParams.get("q") || "", session.user);
  return NextResponse.json({ groups });
}
