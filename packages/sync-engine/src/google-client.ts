import { decryptSecret } from "@zvedeno/shared";

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  refresh_token?: string;
  scope?: string;
};

type DriveFileResponse = {
  id: string;
};

export type GoogleSpreadsheet = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
};

export const GOOGLE_REPORT_TABS = [
  "Dashboard",
  "Sync Status",
  "Raw Data"
] as const;

const REPORT_HEADERS: Record<string, string[]> = {
  Dashboard: ["Напрямок", "Спенд", "Meta результат", "Фактичний результат", "Фактична ціна", "Оновлено"],
  "Sync Status": ["Source", "Status", "Last successful sync", "Rows", "Error"],
  "Raw Data": ["__key", "Date", "Account ID", "Campaign ID", "Ad ID", "Creative ID", "Direction", "Metrics JSON"]
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

function driveFileName(value: string, contentType: string): string {
  const base = value
    .replace(/[^a-z0-9а-яіїєґ._-]+/giu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `creative-${Date.now()}`;
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
        ? "gif"
        : "jpg";
  return `${base}.${extension}`;
}

export async function archiveRemoteImageToDrive(
  accessToken: string,
  sourceUrl: string,
  fileName: string
): Promise<string> {
  const source = await fetch(sourceUrl, { headers: { Accept: "image/*" } });
  if (!source.ok) throw new Error(`Creative image download failed with status ${source.status}`);
  const contentType = (source.headers.get("content-type") ?? "image/jpeg").split(";")[0] ?? "image/jpeg";
  const bytes = Buffer.from(await source.arrayBuffer());
  if (bytes.length === 0) throw new Error("Creative image download returned an empty body");

  const boundary = `zvedeno_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({
    name: driveFileName(fileName, contentType),
    appProperties: { zvedeno: "creative-preview" }
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const file = await readJson<DriveFileResponse>(
    await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }),
    "Google Drive creative upload"
  );

  await readJson(
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ type: "anyone", role: "reader" })
    }),
    "Google Drive creative permission"
  );

  return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(file.id)}`;
}

export async function createGoogleSpreadsheet(
  accessToken: string,
  title: string,
  tabs: readonly string[]
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
          gridProperties: { frozenRowCount: 1, rowCount: 5000, columnCount: 30 }
        }
      }))
    })
  });

  return readJson<GoogleSpreadsheet>(response, "Google spreadsheet creation");
}

export async function getGoogleSpreadsheet(accessToken: string, spreadsheetId: string): Promise<GoogleSpreadsheet> {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  url.searchParams.set("fields", "spreadsheetId,spreadsheetUrl,sheets.properties(sheetId,title)");
  return readJson<GoogleSpreadsheet>(
    await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }),
    "Google spreadsheet metadata"
  );
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
): Promise<{ updatedRange: string | undefined }> {
  if (values.length === 0) return { updatedRange: undefined };
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

export async function ensureGoogleReportTabs(
  accessToken: string,
  spreadsheetId: string,
  tabs: readonly string[] = GOOGLE_REPORT_TABS
): Promise<GoogleSpreadsheet> {
  let spreadsheet = await getGoogleSpreadsheet(accessToken, spreadsheetId);
  const existing = new Set((spreadsheet.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = tabs.filter((tab) => !existing.has(tab));

  if (missing.length > 0) {
    await googleSheetsBatchUpdate(
      accessToken,
      spreadsheetId,
      missing.map((title) => ({
        addSheet: {
          properties: {
            title,
            gridProperties: { frozenRowCount: 1, rowCount: 5000, columnCount: 30 }
          }
        }
      }))
    );
    spreadsheet = await getGoogleSpreadsheet(accessToken, spreadsheetId);
  }

  await initializeGoogleReport(accessToken, spreadsheet);
  return spreadsheet;
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

  await googleValuesBatchUpdate(
    accessToken,
    spreadsheet.spreadsheetId,
    Object.entries(REPORT_HEADERS)
      .filter(([tab]) => titleToId.has(tab))
      .map(([tab, values]) => ({ range: `'${tab}'!A1`, values: [values] }))
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
    if (title === "Raw Data") {
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
