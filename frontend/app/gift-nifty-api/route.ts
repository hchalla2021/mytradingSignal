import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ detail: 'GIFT NIFTY is now provided by the OpeningEdge Zerodha feed.' }, { status: 410 });
}
