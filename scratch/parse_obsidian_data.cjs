const fs = require('fs');
const path = require('path');

const obsidianPath = '/Users/yoshitakaosawa/Library/CloudStorage/GoogleDrive-yoshitaka0904@keio.jp/.shortcut-targets-by-id/1nRs2-ZtmgeGo8mQDUGQVOOPgSC01-hAY/Obsidian Vault/スマサイ開発/大学データ';
const outputPath = path.join(__dirname, '../src/data/universityBaseData.json');

function parseMarkdown(content) {
  const data = {};
  
  const infoSection = content.match(/## 基本情報([\s\S]*?)##/);
  if (infoSection) {
    const infoLines = infoSection[1].split('\n');
    infoLines.forEach(line => {
      if (line.includes(':')) {
        const [key, ...rest] = line.replace(/^- /, '').split(':');
        const trimmedKey = key.trim();
        const value = rest.join(':').trim();
        if (trimmedKey === '大学名') data.university = value;
        if (trimmedKey === '年度') data.year = parseInt(value) || 2026;
        if (trimmedKey === '学部名') data.faculty = value;
        if (trimmedKey === '科目名') data.subject = value;
        if (trimmedKey === '内部科目ID') data.subject_en = value;
        if (trimmedKey === '満点') data.maxScore = parseInt(value);
        if (trimmedKey === '制限時間') data.duration = parseInt(value);
      }
    });
  }

  const passingSection = content.match(/## 合格可能性水準([\s\S]*?)##/);
  if (passingSection) {
    data.passingLines = {};
    const passingLines = passingSection[1].split('\n');
    passingLines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.replace(/^- /, '').split(':').map(s => s.trim());
        const level = key.replace('判定', '');
        const num = parseInt(value);
        if (!isNaN(num)) {
          data.passingLines[level] = num;
        }
      }
    });
  }

  const sourcesSection = content.match(/## 根拠ソース([\s\S]*?)##/);
  if (sourcesSection) {
    data.sources = sourcesSection[1]
      .split('\n')
      .filter(l => l.includes('http'))
      .map(l => l.replace(/^- (?:URL: )?/, '').trim());
  }

  const notesSection = content.match(/## 備考([\s\S]*?)$/);
  if (notesSection) {
    data.notes = notesSection[1]
      .split('\n')
      .filter(l => l.startsWith('- ') && l.trim() !== '- ')
      .map(l => l.replace(/^- /, '').trim());
  }

  return data;
}

if (!fs.existsSync(obsidianPath)) {
  console.error("Obsidian path not found:", obsidianPath);
  process.exit(1);
}

const files = fs.readdirSync(obsidianPath).filter(f => f.endsWith('.md') && !f.startsWith('_') && f !== '運用ルール.md' && !f.includes('テンプレート'));

// Load existing data to perform a safe merge
let existingEntries = [];
if (fs.existsSync(outputPath)) {
  try {
    existingEntries = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  } catch (e) {
    console.warn("Could not parse existing output path, initializing empty:", e.message);
  }
}

const entryMap = new Map(existingEntries.map(item => [item.id || item.fileName?.replace('.md', ''), item]));

files.forEach(file => {
  const content = fs.readFileSync(path.join(obsidianPath, file), 'utf-8');
  const parsed = parseMarkdown(content);
  const id = file.replace('.md', '');
  const existing = entryMap.get(id) || {};
  
  entryMap.set(id, {
    id,
    fileName: file,
    ...existing,
    ...parsed,
    passingLines: { ...(existing.passingLines || {}), ...(parsed.passingLines || {}) }
  });
});

const results = Array.from(entryMap.values());

const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Successfully synced Obsidian vault into ${outputPath} (Total: ${results.length} entries, Vault files: ${files.length})`);
