import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? undefined;
  const start = url.searchParams.get("start") ?? undefined;
  const end = url.searchParams.get("end") ?? undefined;

  return NextResponse.json(await getDashboardData({ date, start, end }));
}
