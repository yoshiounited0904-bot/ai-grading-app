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
        const [key, value] = line.replace(/^- /, '').split(':').map(s => s.trim());
        if (key === '大学名') data.university = value;
        if (key === '学部名') data.faculty = value;
        if (key === '科目名') data.subject = value;
        if (key === '満点') data.maxScore = parseInt(value);
        if (key === '制限時間') data.duration = parseInt(value);
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
        data.passingLines[level] = parseInt(value);
      }
    });
  }

  return data;
}

if (!fs.existsSync(obsidianPath)) {
  console.error("Obsidian path not found:", obsidianPath);
  process.exit(1);
}

const files = fs.readdirSync(obsidianPath).filter(f => f.endsWith('.md') && !f.startsWith('_') && f !== '運用ルール.md');
const results = files.map(file => {
  const content = fs.readFileSync(path.join(obsidianPath, file), 'utf-8');
  return {
    id: file.replace('.md', ''),
    fileName: file,
    ...parseMarkdown(content)
  };
});

const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Successfully generated manifest with ${results.length} entries at ${outputPath}`);
