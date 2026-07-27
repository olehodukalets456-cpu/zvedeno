export async function googleValuesGet(
  accessToken: string,
  spreadsheetId: string,
  range: string
): Promise<Array<Array<string | number | boolean | null>>> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  url.searchParams.set("majorDimension", "ROWS");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`Google values get failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
  return (payload as { values?: Array<Array<string | number | boolean | null>> }).values ?? [];
}
