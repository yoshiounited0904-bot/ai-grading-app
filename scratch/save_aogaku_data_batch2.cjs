const fs = require('fs');
const path = require('path');

const data = [
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "文学部（英米文学科・個別B方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 123,
      "B": 113,
      "C": 105,
      "D": 90,
      "E": 70
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://sougougata-cafe.com/senryaku3/cn27/aoyama-bun.html"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": []
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "文学部（英米文学科・個別C方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 200,
    "durationMinutes": 100,
    "passingLines": {
      "A": 156,
      "B": 144,
      "C": 134,
      "D": 115,
      "E": 90
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://www.haradaeigo.com/aoyama-gakuin-english-complete-guide/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。独自英語に高配点200点を置く個別C方式（合格最低点207/300、得点率69.0％）に準拠。リスニング・ライティングを含む最難関測定に合わせ、ボーダーを約67%（134点）と想定して各ラインを算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "文学部（英米文学科・個別D方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 100,
    "durationMinutes": 60,
    "passingLines": {
      "A": 85,
      "B": 78,
      "C": 70,
      "D": 60,
      "E": 45
    },
    "sources": [],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": []
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "経済学部（経済・現代経済デザイン・個別A/B方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 90,
    "passingLines": {
      "A": 115,
      "B": 105,
      "C": 98,
      "D": 85,
      "E": 65
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。現代経済デザイン学科・個別A方式の合格最低点161/250（得点率約64.4％）をベースに算出。独自筆記試験（150点・90分、長文読解と記述式併用）の高い記述レベルに合わせ、英語の想定ボーダーを約65%に設定。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "経営学部（経営・マーケティング・個別A/B方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 90,
    "passingLines": {
      "A": 123,
      "B": 113,
      "C": 105,
      "D": 90,
      "E": 70
    },
    "sources": [],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": []
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "社会情報学部（社会情報・個別A方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 200,
    "durationMinutes": 80,
    "passingLines": {
      "A": 165,
      "B": 152,
      "C": 144,
      "D": 125,
      "E": 100
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。共テ併用個別A方式（独自試験は外国語200点のみ、合格最低点304.3/400、得点率約76.1％）をベースに算出。共通テストの社会情報学科ボーダーが約80%であることから、独自英語のボーダーを約72%と想定して推定。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "社会情報学部（社会情報・個別B方式）",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 200,
    "durationMinutes": null,
    "passingLines": {
      "A": 150,
      "B": 138,
      "C": 126,
      "D": 110,
      "E": 85
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://fast-up.jp/blog/807"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": []
  }
];

const obsidianPath = '/Users/yoshitakaosawa/Library/CloudStorage/GoogleDrive-yoshitaka0904@keio.jp/.shortcut-targets-by-id/1nRs2-ZtmgeGo8mQDUGQVOOPgSC01-hAY/Obsidian Vault/スマサイ開発/大学データ';

data.forEach(item => {
  // Replace / with - in filename
  const sanitizedFaculty = item.faculty.replace(/\//g, '-');
  const fileName = `${item.university}_${sanitizedFaculty}_${item.subject}.md`;
  const filePath = path.join(obsidianPath, fileName);
  
  const content = `# ${item.university} ${item.faculty} ${item.subject}

## 基本情報
- 大学名: ${item.university}
- 学部名: ${item.faculty}
- 科目名: ${item.subject}
- 内部科目ID: ${item.subject_en}
- 満点: ${item.maxScore}
- 制限時間: ${item.durationMinutes || 'null'}

## 合格可能性水準
${Object.entries(item.passingLines).map(([k, v]) => `- 判定${k}: ${v}`).join('\n')}

## 根拠ソース
${item.sources && item.sources.length > 0 ? item.sources.map(s => `- URL: ${s}`).join('\n') : '- なし'}

## 更新情報
- 更新日: ${item.updatedAt}
- 調査担当AI: ${item.researchAgent}

## 備考
${item.notes && item.notes.length > 0 ? item.notes.map(n => `- ${n}`).join('\n') : '- なし'}
`;

  fs.writeFileSync(filePath, content);
  console.log(`Saved: ${fileName}`);
});
