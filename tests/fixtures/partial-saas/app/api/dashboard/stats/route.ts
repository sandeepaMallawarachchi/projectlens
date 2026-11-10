import { NextResponse } from 'next/server';

// TODO: replace with real aggregation query
const mockStats = { users: 1280, revenue: 42000, churn: 0.03 };

export async function GET() {
  return NextResponse.json(mockStats);
}
