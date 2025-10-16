export async function GET() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`);
    const data = await response.json();
    return Response.json({ backend: data, connected: true });
  } catch (error) {
    return Response.json({ connected: false, error: 'Backend unreachable' });
  }
}