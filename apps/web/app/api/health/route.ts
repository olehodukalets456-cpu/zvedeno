export async function GET() {
  return Response.json({
    service: "zvedeno-web",
    status: "ok",
    timestamp: new Date().toISOString()
  });
}
