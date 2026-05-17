const universityMetadataKnowledge = [
    {
        university: '青山学院大学',
        year: 2025,
        faculty: '経済学部',
        subject: '英語',
        subject_en: 'english',
        max_score: 150,
        duration_minutes: 80,
        passing_lines: { A: 125, B: 115, C: 110, D: 95, E: 75 },
        notes: [
            '推定値。経済学部全学部日程の合格最低点262/350（得点率約74.9％）を基準とし、ボーダーを約73%に置いて各判定ラインを推定。'
        ],
        sources: [
            'https://bestjuku.com/shingaku/s-article/37471/',
            'https://englishx.jp/aoyama-all-faculties-english-preparation/'
        ]
    },
    {
        university: '青山学院大学',
        year: 2025,
        faculty: '法学部',
        subject: '英語',
        subject_en: 'english',
        max_score: 150,
        duration_minutes: 80,
        passing_lines: { A: 120, B: 112, C: 105, D: 90, E: 70 },
        notes: [
            '推定値。全学部日程（法学科）の合格最低点253/350（得点率約72.3％）をベースに算出。'
        ],
        sources: [
            'https://bestjuku.com/shingaku/s-article/37471/',
            'https://englishx.jp/aoyama-all-faculties-english-preparation/'
        ]
    },
    {
        university: '青山学院大学',
        year: 2025,
        faculty: '経営学部',
        subject: '英語',
        subject_en: 'english',
        max_score: 150,
        duration_minutes: 80,
        passing_lines: { A: 125, B: 115, C: 110, D: 95, E: 75 },
        notes: [
            '推定値。全学部日程（経営学科）の合格最低点261/350（得点率約74.6％）を基準に推定。'
        ],
        sources: [
            'https://bestjuku.com/shingaku/s-article/37471/',
            'https://englishx.jp/aoyama-all-faculties-english-preparation/'
        ]
    },
    {
        university: '青山学院大学',
        year: 2025,
        faculty: '社会情報学部',
        subject: '英語',
        subject_en: 'english',
        max_score: 200,
        duration_minutes: null,
        passing_lines: { A: 160, B: 145, C: 135, D: 115, E: 90 },
        notes: [
            '推定値。独自問題英語200点を課す個別A方式における合格者得点比率（難易度偏差値60.0より、ボーダー約67.5％）を想定して算出。制限時間は共通テスト等との組み合わせ独自様式のためnull。'
        ],
        sources: [
            'https://bestjuku.com/shingaku/s-article/37471/',
            'https://englishx.jp/aoyama-all-faculties-english-preparation/'
        ]
    },
    {
        university: '青山学院大学',
        year: 2025,
        faculty: '理工学部',
        subject: '英語',
        subject_en: 'english',
        max_score: 150,
        duration_minutes: 80,
        passing_lines: { A: 120, B: 110, C: 103, D: 88, E: 70 },
        notes: [
            '推定値。理工学部の全学部日程（合格最低点比率約67〜72％、物理科学科288/400等）を基準に算出。'
        ],
        sources: [
            'https://bestjuku.com/shingaku/s-article/37471/',
            'https://englishx.jp/aoyama-all-faculties-english-preparation/'
        ]
    }
];

const normalize = (value) => `${value || ''}`.trim();
const keyOf = (entry) => [entry.university, entry.year, entry.faculty, entry.subject].map(normalize).join('__');

export const findUniversityMetadataKnowledge = ({ university, faculty, subject, year, subject_en }) => {
    const normalizedUniversity = normalize(university);
    const normalizedFaculty = normalize(faculty);
    const normalizedSubject = normalize(subject);

    return universityMetadataKnowledge.find((entry) => {
        if (normalize(entry.university) !== normalizedUniversity) return false;
        if (normalize(entry.faculty) !== normalizedFaculty) return false;

        const subjectMatches = normalize(entry.subject) === normalizedSubject ||
            (entry.subject_en && subject_en && entry.subject_en === subject_en);
        if (!subjectMatches) return false;

        if (!year) return true;
        return Number(entry.year) === Number(year);
    }) || null;
};

export const listUniversityMetadataKnowledgeCandidates = ({ university, year, subject, subject_en }) => {
    const normalizedUniversity = normalize(university);
    const normalizedSubject = normalize(subject);

    return universityMetadataKnowledge.filter((entry) => {
        if (normalizedUniversity && normalize(entry.university) !== normalizedUniversity) return false;
        if (year && Number(entry.year) !== Number(year)) return false;

        if (!normalizedSubject && !subject_en) return true;

        return normalize(entry.subject) === normalizedSubject ||
            (entry.subject_en && subject_en && entry.subject_en === subject_en);
    }).map((entry) => ({
        ...entry,
        key: keyOf(entry),
        label: `${entry.faculty} / ${entry.subject} / ${entry.year}`
    }));
};

export { universityMetadataKnowledge };
