/*
 * Logged-in answer image extractor.
 *
 * Usage:
 * 1. Open the answer page in the browser after logging in.
 * 2. Open DevTools Console or Sources > Snippets.
 * 3. Run this script on that answer page.
 * 4. A new tab opens with detected images and copy/download helpers.
 *
 * This runs inside the logged-in page, so it can see images that require
 * your existing browser session. It does not collect or store passwords.
 */
(() => {
  const absolutize = (url) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return '';
    }
  };

  const fromSrcset = (srcset) => {
    if (!srcset) return [];
    return srcset
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  };

  const backgroundUrls = [...document.querySelectorAll('*')]
    .flatMap((el) => {
      const bg = getComputedStyle(el).backgroundImage || '';
      return [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
    });

  const attributeUrls = [...document.querySelectorAll('*')]
    .flatMap((el) => {
      const attrs = [
        'href',
        'src',
        'srcset',
        'data-src',
        'data-original',
        'data-lazy-src',
        'data-srcset',
        'data-url',
        'data-original-url',
      ];
      return attrs.flatMap((attr) => {
        const value = el.getAttribute(attr);
        if (!value) return [];
        return attr.includes('srcset') ? fromSrcset(value) : [value];
      });
    });

  const performanceUrls = performance.getEntriesByType('resource')
    .filter((entry) => ['img', 'css', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType))
    .map((entry) => entry.name);

  const candidates = [
    ...[...document.images].flatMap((img) => [
      img.currentSrc,
      img.src,
      img.dataset?.src,
      img.dataset?.original,
      img.dataset?.lazySrc,
      ...fromSrcset(img.srcset),
      ...fromSrcset(img.dataset?.srcset),
    ]),
    ...[...document.querySelectorAll('picture source')].flatMap((source) => [
      source.srcset,
      source.dataset?.srcset,
    ]).flatMap(fromSrcset),
    ...attributeUrls,
    ...performanceUrls,
    ...backgroundUrls,
  ]
    .map(absolutize)
    .filter(Boolean);

  const urls = [...new Set(candidates)]
    .filter((url) => {
      if (url.startsWith('blob:')) return true;
      if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url)) return true;
      if (/\/(image|img|photo|answer|kaisetsu|kaitou|ans|file|contents?)\b/i.test(url)) return true;
      return false;
    });

  const rows = urls.map((url, index) => ({ index: index + 1, url }));

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>Extracted answer images</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(255,255,255,.95);
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 20px;
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    h1 { font-size: 18px; margin: 0; }
    p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
    button, a.action {
      border: 1px solid #0f172a;
      background: #0f172a;
      color: white;
      border-radius: 6px;
      padding: 9px 12px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      font-size: 13px;
    }
    button.secondary, a.secondary {
      background: white;
      color: #0f172a;
    }
    main {
      padding: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }
    article {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    img {
      width: 100%;
      height: 180px;
      object-fit: contain;
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
    }
    .meta {
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    code {
      display: block;
      font-size: 11px;
      color: #475569;
      word-break: break-all;
      background: #f8fafc;
      padding: 8px;
      border-radius: 4px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>抽出画像 ${rows.length} 件</h1>
      <p>${location.href}</p>
    </div>
    <div class="actions">
      <button id="copyJson">JSONをコピー</button>
      <button id="copyUrls" class="secondary">URL一覧をコピー</button>
      <button id="saveFolder" class="secondary">同じフォルダに一括保存</button>
      <button id="downloadAll" class="secondary">一括ダウンロード</button>
      <button id="openAll" class="secondary">全画像を開く</button>
    </div>
  </header>
  <main>
    ${rows.map(({ index, url }) => `
      <article>
        <img src="${url.replace(/"/g, '&quot;')}" loading="lazy">
        <div class="meta">
          <strong>#${index}</strong>
          <code>${url.replace(/</g, '&lt;')}</code>
          <div class="actions">
            <a class="action" href="${url.replace(/"/g, '&quot;')}" target="_blank" rel="noreferrer">開く</a>
            <a class="action secondary" href="${url.replace(/"/g, '&quot;')}" download="answer_${String(index).padStart(2, '0')}">保存</a>
          </div>
        </div>
      </article>
    `).join('')}
  </main>
  <script>
    const rows = ${JSON.stringify(rows)};
    document.getElementById('copyJson').onclick = async () => {
      await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
      alert('JSONをコピーしました');
    };
    document.getElementById('copyUrls').onclick = async () => {
      await navigator.clipboard.writeText(rows.map(row => row.url).join('\\n'));
      alert('URL一覧をコピーしました');
    };
    const extensionFromUrl = (url) => {
      const clean = url.split('?')[0].split('#')[0];
      const match = clean.match(/\\.([a-z0-9]+)$/i);
      return match ? match[1].toLowerCase() : 'png';
    };
    const fileNameForRow = (row) => {
      return 'answer_' + String(row.index).padStart(2, '0') + '.' + extensionFromUrl(row.url);
    };
    const fetchBlob = async (url) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      return await res.blob();
    };
    document.getElementById('saveFolder').onclick = async () => {
      if (!window.showDirectoryPicker) {
        alert('このブラウザはフォルダ指定保存に未対応です。Chrome / Edgeで試すか、「一括ダウンロード」を使ってください。');
        return;
      }
      const dir = await window.showDirectoryPicker();
      let saved = 0;
      for (const row of rows) {
        const blob = await fetchBlob(row.url);
        const handle = await dir.getFileHandle(fileNameForRow(row), { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        saved += 1;
      }
      alert(saved + '件を選択フォルダに保存しました');
    };
    document.getElementById('downloadAll').onclick = async () => {
      for (const row of rows) {
        const a = document.createElement('a');
        a.href = row.url;
        a.download = fileNameForRow(row);
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    };
    document.getElementById('openAll').onclick = () => {
      rows.forEach((row) => window.open(row.url, '_blank'));
    };
  </script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    console.log(rows);
    alert('ポップアップがブロックされました。Consoleに抽出結果を出力しました。');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
})();
