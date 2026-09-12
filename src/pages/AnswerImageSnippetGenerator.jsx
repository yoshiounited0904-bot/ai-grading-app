import React, { useMemo, useState } from 'react';

export const buildSnippet = ({ university, faculty, year, subject }) => {
    const prefix = [university, faculty, year, subject].filter(Boolean).join('_') || '大学_学部_年度_科目';

    return `(() => {
  const FILE_PREFIX = '${prefix.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';

  const sanitizeFileName = (name) =>
    String(name)
      .trim()
      .replace(/[\\\\/:*?"<>|]/g, '_')
      .replace(/\\s+/g, '_');

  const prefix = sanitizeFileName(FILE_PREFIX);

  const imgs = [...document.images]
    .map((img) => {
      const rect = img.getBoundingClientRect();
      const src = img.currentSrc || img.src;
      return {
        src,
        width: img.naturalWidth,
        height: img.naturalHeight,
        displayWidth: Math.round(rect.width),
        displayHeight: Math.round(rect.height),
      };
    })
    .filter(x => {
      if (!x.src) return false;
      if (/logo|icon|favicon|common|header|footer|btn|arrow|loading|blank/i.test(x.src)) return false;
      if (x.width < 500 && x.height < 300) return false;
      if (x.displayWidth < 250 && x.displayHeight < 250) return false;
      return true;
    });

  const oldPanel = document.getElementById('answerImageSavePanel');
  if (oldPanel) oldPanel.remove();

  const makeFileName = (i) => {
    return \`\${prefix}_answer_\${String(i + 1).padStart(2, '0')}.gif\`;
  };

  const panel = document.createElement('div');
  panel.id = 'answerImageSavePanel';
  panel.style.cssText = \`
    position: fixed;
    z-index: 999999;
    right: 16px;
    bottom: 16px;
    width: 420px;
    max-height: 70vh;
    overflow: auto;
    background: white;
    color: #111;
    border: 2px solid #111;
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,.25);
    padding: 14px;
    font-family: sans-serif;
  \`;

  panel.innerHTML = \`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
      <strong>解答画像 \${imgs.length}件</strong>
      <button id="answerImagePanelClose" style="border:1px solid #111;background:#fff;padding:4px 8px;cursor:pointer;">閉じる</button>
    </div>
    <p style="font-size:12px;color:#555;line-height:1.5;margin:0 0 10px;">
      各リンクをクリックして画像を開き、右クリックで表示名どおりに保存してください。
    </p>
    <div style="display:grid;gap:8px;">
      \${imgs.map((x, i) => {
        const fileName = makeFileName(i);
        return \`
          <a
            href="\${x.src}"
            target="_blank"
            download="\${fileName}"
            style="display:block;border:1px solid #ddd;border-radius:6px;padding:8px;text-decoration:none;color:#111;background:#f8fafc;"
          >
            <strong>\${fileName}</strong>
            <div style="font-size:12px;color:#555;">\${x.width}x\${x.height}</div>
          </a>
        \`;
      }).join('')}
    </div>
  \`;

  document.body.appendChild(panel);
  document.getElementById('answerImagePanelClose').onclick = () => panel.remove();

  alert(\`\${imgs.length}件の保存リンクを作りました\`);
})();`;
};

function AnswerImageSnippetGenerator() {
    const [form, setForm] = useState({
        university: '',
        faculty: '',
        year: new Date().getFullYear().toString(),
        subject: ''
    });
    const [copied, setCopied] = useState(false);

    const snippet = useMemo(() => buildSnippet(form), [form]);

    const updateField = (field, value) => {
        setCopied(false);
        setForm(prev => ({ ...prev, [field]: value }));
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(snippet);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
    };

    const filePrefixPreview = [form.university, form.faculty, form.year, form.subject]
        .filter(Boolean)
        .join('_') || '大学_学部_年度_科目';

    return (
        <div className="min-h-screen bg-indigo-50/30 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="mb-6">
                    <h1 className="text-3xl font-black text-navy-blue">解答画像コード生成</h1>
                    <p className="text-sm font-bold text-gray-500 mt-2">
                        大学・学部・年度・科目を入れると、保存名つきのDevTools貼り付けコードを生成します。
                    </p>
                </div>

                <div className="grid lg:grid-cols-[380px_1fr] gap-6">
                    <section className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 h-fit">
                        <div className="grid gap-4">
                            {[
                                ['university', '大学名', '明治大学'],
                                ['faculty', '学部・方式', '商学部'],
                                ['year', '年度', '2025'],
                                ['subject', '科目', '日本史']
                            ].map(([field, label, placeholder]) => (
                                <label key={field} className="block">
                                    <span className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1">
                                        {label}
                                    </span>
                                    <input
                                        value={form[field]}
                                        onChange={(e) => updateField(field, e.target.value)}
                                        placeholder={placeholder}
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-navy-blue outline-none focus:border-indigo-400 focus:bg-white"
                                    />
                                </label>
                            ))}
                        </div>

                        <div className="mt-5 rounded-xl bg-indigo-50 border border-indigo-100 p-4">
                            <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">
                                保存名プレビュー
                            </div>
                            <div className="text-xs font-mono font-bold text-indigo-700 break-all">
                                {filePrefixPreview}_answer_01.gif
                            </div>
                        </div>

                        <button
                            onClick={handleCopy}
                            className="mt-5 w-full rounded-xl bg-navy-blue px-5 py-3 text-sm font-black text-white shadow hover:bg-navy-light transition-colors"
                        >
                            {copied ? 'コピーしました' : 'コードをコピー'}
                        </button>
                    </section>

                    <section className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-5">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-sm font-black text-navy-blue">生成コード</h2>
                            <button
                                onClick={handleCopy}
                                className="rounded-lg bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-600 hover:bg-indigo-100 transition-colors"
                            >
                                コピー
                            </button>
                        </div>
                        <textarea
                            value={snippet}
                            readOnly
                            className="w-full h-[620px] resize-none rounded-xl border border-gray-200 bg-gray-950 p-4 font-mono text-xs leading-relaxed text-indigo-50 outline-none"
                        />
                    </section>
                </div>
            </div>
        </div>
    );
}

export default AnswerImageSnippetGenerator;
