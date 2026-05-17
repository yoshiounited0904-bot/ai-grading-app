const fs = require('fs');
const path = require('path');

const data = [
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "教育人間科学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 122,
      "B": 113,
      "C": 105,
      "D": 90,
      "E": 72
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://www.haradaeigo.com/aoyama-gakuin-english-complete-guide/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（教育学科）の合格最低点245/350（得点率約70.0％）および河合塾偏差値60.0を基に算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "経済学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 125,
      "B": 115,
      "C": 110,
      "D": 95,
      "E": 75
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。経済学部全学部日程の合格最低点262/350（得点率約74.9％）および偏差値62.5をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "法学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 120,
      "B": 112,
      "C": 105,
      "D": 90,
      "E": 70
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（法学科）の合格最低点253/350（得点率約72.3％）および偏差値60.0をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "経営学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 125,
      "B": 115,
      "C": 110,
      "D": 95,
      "E": 75
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（経営学科）の合格最低点261/350（得点率約74.6％）および偏差値62.5をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "国際政治経済学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 128,
      "B": 118,
      "C": 112,
      "D": 96,
      "E": 76
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（国際政治学科）の合格最低点270/350（得点率約77.1％）および偏差値62.5〜65.0をベースに高めに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "総合文化政策学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 122,
      "B": 113,
      "C": 107,
      "D": 92,
      "E": 72
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://www.haradaeigo.com/aoyama-gakuin-english-complete-guide/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（総合文化政策学科）の合格最低点254/350（得点率約72.6％）および偏差値62.5をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "理工学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 120,
      "B": 110,
      "C": 103,
      "D": 88,
      "E": 70
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（物理科学科等）の3科目合格最低点288/400（得点率72.0％）および偏差値55.0〜57.5をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "社会情報学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 118,
      "B": 108,
      "C": 102,
      "D": 87,
      "E": 68
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部A方式の合格最低点242/350（得点率約69.1％）および偏差値57.5〜60.0をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "地球社会共生学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 118,
      "B": 108,
      "C": 102,
      "D": 87,
      "E": 68
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（地球社会共生学科）の合格最低点244/350（得点率約69.7％）および偏差値57.5〜60.0をベースに算出。"
    ]
  },
  {
    "university": "青山学院大学",
    "year": 2025,
    "faculty": "コミュニティ人間科学部",
    "subject": "英語",
    "subject_en": "english",
    "maxScore": 150,
    "durationMinutes": 80,
    "passingLines": {
      "A": 115,
      "B": 105,
      "C": 98,
      "D": 83,
      "E": 65
    },
    "sources": [
      "https://passnavi.obunsha.co.jp/univ/2260/border/",
      "https://bestjuku.com/shingaku/s-article/37471/"
    ],
    "updatedAt": "2026-05-16",
    "researchAgent": "Gemini",
    "notes": [
      "推定値。全学部日程（コミュニティ人間科学科）の合格最低点236/350（得点率約67.4％）および偏差値55.0〜57.5をベースに算出。"
    ]
  }
];

const obsidianPath = '/Users/yoshitakaosawa/Library/CloudStorage/GoogleDrive-yoshitaka0904@keio.jp/マイドライブ/Obsidian Vault/スマサイ開発/大学データ';

data.forEach(item => {
  const fileName = `${item.university}_${item.faculty}_${item.subject}.md`;
  const filePath = path.join(obsidianPath, fileName);
  
  const content = `# ${item.university} ${item.faculty} ${item.subject}

## 基本情報
- 大学名: ${item.university}
- 学部名: ${item.faculty}
- 科目名: ${item.subject}
- 内部科目ID: ${item.subject_en}
- 満点: ${item.maxScore}
- 制限時間: ${item.durationMinutes}

## 合格可能性水準
${Object.entries(item.passingLines).map(([k, v]) => `- 判定${k}: ${v}`).join('\n')}

## 根拠ソース
${item.sources.map(s => `- URL: ${s}`).join('\n')}

## 更新情報
- 更新日: ${item.updatedAt}
- 調査担当AI: ${item.researchAgent}

## 備考
- ${item.notes.join('\n- ')}
`;

  fs.writeFileSync(filePath, content);
  console.log(`Saved: ${fileName}`);
});
