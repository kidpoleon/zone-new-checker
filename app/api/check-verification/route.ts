import { NextResponse } from "next/server";
import { isHumanVerified } from "@/lib/humanVerification";

export async function GET(req: Request) {
  try {
    const now = Date.now();
    const verified = await isHumanVerified(req, now);
    
    return NextResponse.json({ 
      verified,
      timestamp: now 
    });
  } catch (error) {
    // If verification check fails (e.g., missing config), treat as unverified
    return NextResponse.json({ 
      verified: false,
      error: "Verification check failed"
    }, { status: 500 });
  }
}

export const runtime = "edge";
