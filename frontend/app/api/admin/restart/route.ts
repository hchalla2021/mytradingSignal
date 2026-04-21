import { NextRequest, NextResponse } from 'next/server';

// Restart button removed from UI — endpoint disabled to prevent unauthenticated shell exec.
export async function POST(_req: NextRequest) {
  return NextResponse.json({ message: 'Not found' }, { status: 404 });
}

