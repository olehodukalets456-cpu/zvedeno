import { decryptSecret } from "@zvedeno/shared";

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  refresh_token?: string;
  scope?: string;
};

type GoogleSpreadsheet = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
};

async function readJson<T>(response: Response, label: string): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

export async function refreshGoogleAccessToken(encryptedRefreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are not configured");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptSecret(encryptedRefreshToken),
    grant_type: "refresh_token"
  });

  const token = await readJson<GoogleTokenResponse>(
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }),
    "Google token refresh"
  );
  return token.access_token;
}

export async function createGoogleSpreadsheet(
  accessToken: string,
  title: string,
  tabs: string[]
): Promise<GoogleSpreadsheet> {
  const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: { title, locale: "en_US" },
      sheets: tabs.map((tab, index) => ({
        properties: {
          title: tab,
          index,
          gridProperties: { frozenRowCount: 1, rowCount: 2000, columnCount: 30 }
        }
      }))
    })
  });

  return readJson<GoogleSpreadsheet>(response, "Google spreadsheet creation");
}

export async function googleSheetsBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[]
): Promise<void> {
  if (requests.length === 0) return;
  await readJson(
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ requests })
    }),
    "Google Sheets batch update"
  );
}

export async function googleValuesBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  data: Array<{ range: string; values: Array<Array<string | number | boolean | null>> }>
): Promise<void> {
  if (data.length === 0) return;
  await readJson(
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data })
    }),
    "Google values batch update"
  );
}

export async function googleValuesAppend(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: Array<Array<string | number | boolean | null>>
): Promise<{ updatedRange?: string }> {
  if (values.length === 0) return {};
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append`);
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");

  return readJson<{ updates?: { updatedRange?: string } }>(
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values })
    }),
    "Google values append"
  ).then((payload) => ({ updatedRange: payload.updates?.updatedRange }));
}

export async function initializeGoogleReport(
  accessToken: string,
  spreadsheet: GoogleSpreadsheet
): Promise<void> {
  const titleToId = new Map<string, number>();
  for (const sheet of spreadsheet.sheets ?? []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && id !== undefined) titleToId.set(title, id);
  }

  const headers: Record<string, string[]> = {
    Dashboard: ["Metric", "Value", "Updated at"],
    Campaigns: ["__key", "Campaign", "Account", "Spend", "Impressions", "Clicks", "Results", "CPA", "CTR", "CPC", "Status", "Comment"],
    Daily: ["__key", "Date", "Account", "Campaign", "Ad set", "Ad", "Creative", "Spend", "Impressions", "Clicks", "Results", "CPA", "CTR", "CPC", "Status", "Comment"],
    Creatives: ["__key", "Preview", "Creative", "Format", "Accounts", "Spend", "Impressions", "Clicks", "Results", "CPA", "CTR", "CPC", "First seen", "Last seen", "Status", "Comment"],
    Funnel: ["Stage", "Value", "Conversion", "Cost"],
    "Sync Status": ["Source", "Status", "Last successful sync", "Rows", "Error"],
    "Raw Data": ["__key", "Date", "Account ID", "Campaign ID", "Ad set ID", "Ad ID", "Creative ID", "Metrics JSON"]
  };

  await googleValuesBatchUpdate(
    accessToken,
    spreadsheet.spreadsheetId,
    Object.entries(headers).map(([tab, values]) => ({ range: `'${tab}'!A1`, values: [values] }))
  );

  const requests: unknown[] = [];
  for (const [title, sheetId] of titleToId) {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.05, green: 0.16, blue: 0.27 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            horizontalAlignment: "CENTER"
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
      }
    });
    requests.push({
      setBasicFilter: {
        filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0 } }
      }
    });
    if (["Campaigns", "Daily", "Creatives", "Raw Data"].includes(title)) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { hiddenByUser: true },
          fields: "hiddenByUser"
        }
      });
    }
  }

  await googleSheetsBatchUpdate(accessToken, spreadsheet.spreadsheetId, requests);
}

export function parseUpdatedRangeStartRow(updatedRange: string | undefined): number | undefined {
  if (!updatedRange) return undefined;
  const match = updatedRange.match(/![A-Z]+(\d+):/i) ?? updatedRange.match(/![A-Z]+(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}
