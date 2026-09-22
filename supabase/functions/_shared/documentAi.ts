// Google Cloud Document AI Layout Parser integration
import { DEFAULT_GCP_CONFIG } from "./gcpConfig.ts";

export interface DocumentAiConfig {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
  processorId?: string;
  location?: string;
}

export interface ParsedDocumentAiResult {
  markdown: string;
  totalBlocks: number;
  totalPages: number;
  rawBlocksSummary: Array<{ page: number; count: number }>;
}

function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemToBinary(pem: string): Uint8Array {
  const cleanPem = pem
    .replace(/-----BEGIN[ A-Z0-9_-]+-----/g, "")
    .replace(/-----END[ A-Z0-9_-]+-----/g, "")
    .replace(/[\r\n\s]/g, "");
  const binaryString = atob(cleanPem);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates an OAuth2 access token for Google Cloud using Web Crypto RS256
 */
export async function getGoogleCloudAccessToken(config?: DocumentAiConfig): Promise<string> {
  const clientEmail = Deno.env.get("GCP_SERVICE_ACCOUNT_EMAIL") || config?.clientEmail || DEFAULT_GCP_CONFIG.clientEmail;
  const rawKey = Deno.env.get("GCP_PRIVATE_KEY") || config?.privateKey || DEFAULT_GCP_CONFIG.privateKey;

  if (!clientEmail || !rawKey) {
    throw new Error("GCP Service Account credentials not configured");
  }

  const cleanKey = rawKey.replace(/\\n/g, "\n");
  const binaryDer = pemToBinary(cleanKey);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = arrayBufferToBase64Url(signature);
  const jwt = `${signingInput}.${encodedSignature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Google OAuth2 Token Error: ${JSON.stringify(tokenData)}`);
  }

  return tokenData.access_token;
}

interface LayoutItem {
  page: number;
  blockId: string;
  type: string;
  text: string;
}

function walkBlocks(blocks: any[], defaultPage = 1): LayoutItem[] {
  const items: LayoutItem[] = [];
  if (!Array.isArray(blocks)) return items;

  for (const b of blocks) {
    const page = b.pageSpan?.pageStart || defaultPage;

    if (b.textBlock) {
      const text = String(b.textBlock.text || "").trim();
      const type = b.textBlock.type || "paragraph";
      if (text) {
        items.push({
          page,
          blockId: b.blockId || "",
          type,
          text,
        });
      }
      if (Array.isArray(b.textBlock.blocks) && b.textBlock.blocks.length > 0) {
        items.push(...walkBlocks(b.textBlock.blocks, page));
      }
    }

    if (b.listBlock && Array.isArray(b.listBlock.listEntries)) {
      for (const entry of b.listBlock.listEntries) {
        if (Array.isArray(entry.blocks)) {
          items.push(...walkBlocks(entry.blocks, page));
        }
      }
    }

    if (b.tableBlock && Array.isArray(b.tableBlock.tableRows)) {
      for (const row of b.tableBlock.tableRows) {
        if (Array.isArray(row.cells)) {
          const cellTexts = row.cells.map((c: any) => {
            if (Array.isArray(c.blocks)) {
              return walkBlocks(c.blocks, page).map(i => i.text).join(" ");
            }
            return "";
          }).filter(Boolean);
          if (cellTexts.length > 0) {
            items.push({
              page,
              blockId: b.blockId || "",
              type: "table-row",
              text: cellTexts.join(" | "),
            });
          }
        }
      }
    }
  }

  return items;
}

function formatLayoutMarkdown(items: LayoutItem[]): string {
  const pageMap = new Map<number, LayoutItem[]>();
  for (const item of items) {
    if (!pageMap.has(item.page)) {
      pageMap.set(item.page, []);
    }
    pageMap.get(item.page)!.push(item);
  }

  const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const lines: string[] = [];

  for (const pageNum of sortedPages) {
    lines.push(`\n## 【ページ ${pageNum}】\n`);
    const pageItems = pageMap.get(pageNum)!;
    let sectionIdx = 1;
    for (const item of pageItems) {
      if (!item.text || item.text === "☐") continue;
      
      const tag = `[P${pageNum}-§${sectionIdx}]`;
      if (item.type.startsWith("heading")) {
        lines.push(`### ${tag} ${item.text}`);
      } else if (item.type === "table-row") {
        lines.push(`- ${tag} [表] ${item.text}`);
      } else {
        lines.push(`${tag} ${item.text}`);
      }
      sectionIdx++;
    }
  }

  return lines.join("\n\n");
}

function sanitizeBase64(input: string): { cleanBase64: string; detectedMime: string } {
  let s = String(input || "").trim();
  let detectedMime = "application/pdf";

  // 1. Remove data URL prefix (e.g. data:application/pdf;base64, or data:application/octet-stream;base64,)
  const commaIdx = s.indexOf(",");
  if (commaIdx !== -1 && commaIdx < 120) {
    const prefix = s.slice(0, commaIdx);
    const mimeMatch = prefix.match(/data:([^;]+);base64/i);
    if (mimeMatch && mimeMatch[1]) {
      detectedMime = mimeMatch[1].trim();
    }
    s = s.slice(commaIdx + 1);
  }

  // 2. Remove any remaining prefix if present
  s = s.replace(/^data:[^;]+;base64,/i, "");

  // 3. Remove all whitespace, newlines, and carriage returns
  s = s.replace(/[\r\n\s]/g, "");

  // 4. URL decode if it contains % (e.g. URL-encoded base64)
  if (s.includes("%")) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // ignore
    }
  }

  // 5. Convert URL-safe base64 (- and _) to standard base64 (+ and /)
  s = s.replace(/-/g, "+").replace(/_/g, "/");

  // 6. Ensure correct 4-byte padding
  while (s.length % 4 !== 0) {
    s += "=";
  }

  // 7. Validate magic bytes
  if (s.startsWith("JVBERi")) {
    detectedMime = "application/pdf";
  } else if (s.startsWith("/9j/")) {
    detectedMime = "image/jpeg";
  } else if (s.startsWith("iVBORw0KGgo")) {
    detectedMime = "image/png";
  }

  return { cleanBase64: s, detectedMime };
}

/**
 * Call Document AI Layout Parser on a base64-encoded PDF
 */
export async function parsePdfWithDocumentAi(
  pdfBase64: string,
  config?: DocumentAiConfig,
): Promise<ParsedDocumentAiResult> {
  const processorId = Deno.env.get("DOCUMENT_AI_PROCESSOR_ID") || config?.processorId || DEFAULT_GCP_CONFIG.processorId;
  const location = Deno.env.get("DOCUMENT_AI_LOCATION") || config?.location || DEFAULT_GCP_CONFIG.location;
  const projectId = Deno.env.get("GCP_PROJECT_ID") || config?.projectId || DEFAULT_GCP_CONFIG.projectId;

  const token = await getGoogleCloudAccessToken(config);

  const { cleanBase64, detectedMime } = sanitizeBase64(pdfBase64);

  console.log(`[Document AI] Preparing request: processorId=${processorId}, location=${location}, mimeType=${detectedMime}, base64Length=${cleanBase64.length}`);

  if (!cleanBase64 || cleanBase64.length < 50) {
    throw new Error(`送信されたBase64データが短すぎるか空です（長さ: ${cleanBase64.length}）`);
  }

  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${projectId}/locations/${location}/processors/${processorId}:process`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: cleanBase64,
        mimeType: detectedMime,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const errorMsg = data.error?.message || JSON.stringify(data);
    console.error(`[Document AI Error] (${res.status}):`, errorMsg);
    throw new Error(`Document AI Process Error (${res.status}): ${errorMsg}`);
  }

  const topBlocks = data.document?.documentLayout?.blocks || [];
  const allItems = walkBlocks(topBlocks);

  const markdown = formatLayoutMarkdown(allItems);

  // Calculate summary
  const pageMap = new Map<number, number>();
  for (const item of allItems) {
    pageMap.set(item.page, (pageMap.get(item.page) || 0) + 1);
  }

  const rawBlocksSummary = Array.from(pageMap.entries())
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => a.page - b.page);

  return {
    markdown,
    totalBlocks: allItems.length,
    totalPages: pageMap.size,
    rawBlocksSummary,
  };
}
