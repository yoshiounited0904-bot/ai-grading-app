export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// exam-pdfs バケットが Private の場合、サービスロールで署名付きURLを生成してからフェッチする
export async function fetchPrivatePdfAsInlineData(pdfPath: string): Promise<unknown[]> {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const match = pdfPath.match(/\/exam-pdfs\/(.+?)(\?|$)/);
    let fetchUrl = pdfPath;
    if (match) {
      const { data } = await serviceClient.storage
        .from("exam-pdfs")
        .createSignedUrl(match[1], 300);
      if (data?.signedUrl) fetchUrl = data.signedUrl;
    }
    const res = await fetch(fetchUrl);
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return [{ inlineData: { data: btoa(binary), mimeType: "application/pdf" } }];
  } catch (e) {
    console.warn("Could not fetch PDF:", e);
    return [];
  }
}
