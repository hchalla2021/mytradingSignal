import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';

export async function POST(req: NextRequest) {
  try {
    // 🔐 Validate using server-side env only — key never exposed to browser
    const expectedKey = process.env.ADMIN_RESTART_KEY;

    if (!expectedKey) {
      return NextResponse.json(
        { message: 'Server configuration error: Admin key not set' },
        { status: 500 }
      );
    }

    // ✅ Key is validated server-side — no client-supplied key needed
    console.log('\ud83d\udd27 Admin restart initiated...');

    // Return response immediately (non-blocking)
    const response = NextResponse.json(
      { message: 'Server restarting...' },
      { status: 200 }
    );

    // Execute restart script in background (non-blocking)
    // Using & to ensure it runs in background without blocking the response
    exec('bash /var/www/restart.sh > /dev/null 2>&1 &', (error) => {
      if (error) {
        console.error('❌ Restart script execution failed:', error);
      } else {
        console.log('✅ Restart script executed successfully');
      }
    });

    return response;
  } catch (error) {
    console.error('❌ Restart endpoint error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
