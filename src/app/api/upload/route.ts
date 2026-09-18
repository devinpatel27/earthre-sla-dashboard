import { NextResponse } from "next/server";
import { cleanMonitoringCsv } from "@/lib/cleaner";
import { saveBatch } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a CSV file using the file field." }, { status: 400 });
  }

  const text = await file.text();
  const { summary, records } = cleanMonitoringCsv(text, file.name);
  await saveBatch(summary, records);

  return NextResponse.json({ summary });
}
