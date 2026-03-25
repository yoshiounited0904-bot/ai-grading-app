import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAdminExamById, saveAdminExam, uploadExamPdf } from '../services/adminExamService';
import { generateExamMasterData, regenerateQuestionExplanation, regenerateDetailedAnalysis, regeneratePointsAllocation, generateSectionDetailedAnalysis } from '../services/adminGeminiService';
import { getUniversities } from '../data/examRegistry';

function AdminExamEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = id === 'new';

    const [loading, setLoading] = useState(!isNew);
    const [generating, setGenerating] = useState(false);
    const [generatingDetailed, setGeneratingDetailed] = useState(false);
    const [generatingSectionAnalysis, setGeneratingSectionAnalysis] = useState({});
    const [regeneratingPoints, setRegeneratingPoints] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form states
    const [examId, setExamId] = useState('');
    const [university, setUniversity] = useState('');
    const [universityId, setUniversityId] = useState(Math.floor(Math.random() * 10000));
    const [faculty, setFaculty] = useState('');
    const [facultyId, setFacultyId] = useState('fac' + Math.floor(Math.random() * 10000));
    const [year, setYear] = useState(new Date().getFullYear());
    const [subject, setSubject] = useState('');
    const [subjectEn, setSubjectEn] = useState('english');
    const [type, setType] = useState('pdf');
    const [generateDetailed, setGenerateDetailed] = useState(true);

    // PDF/Image files
    const [questionFiles, setQuestionFiles] = useState([]);
    const [sectionCount, setSectionCount] = useState(1);
    const [questionFilesBySection, setQuestionFilesBySection] = useState({ 1: [] });
    const [answerFilesBySection, setAnswerFilesBySection] = useState({ 1: [] });
    const [sectionInstructionsBySection, setSectionInstructionsBySection] = useState({ 1: '' });

    // JSON Data
    const [examData, setExamData] = useState(isNew ? {
        max_score: 100,
        detailed_analysis: '',
        structure: [],
        pdf_path: '',
        passing_lines: { A: 80, B: 70, C: 60, D: 40 }
    } : null);


    const [universitiesData, setUniversitiesData] = useState([]);
    const [activeTab, setActiveTab] = useState('basic'); // 'basic', 'ai', 'editor', 'analysis'

    useEffect(() => {
        getUniversities().then(data => setUniversitiesData(data || []));
        if (!isNew) {
            fetchExam();
        }
    }, [id]);

    useEffect(() => {
        if (isNew) {
            setExamId(`${universityId}-${facultyId}-${year}-${subjectEn}`.toLowerCase());
        }
    }, [universityId, facultyId, year, subjectEn, isNew]);

    const handleUniversityChange = (e) => {
        const val = e.target.value;
        setUniversity(val);
        const match = universitiesData.find(u => u.name === val);
        if (match) {
            setUniversityId(match.id);
        } else {
            setUniversityId(Math.floor(Math.random() * 10000));
        }
    };

    const handleFacultyChange = (e) => {
        const val = e.target.value;
        setFaculty(val);
        const uni = universitiesData.find(u => u.name === university);
        const match = uni?.faculties.find(f => f.name === val);
        if (match) {
            setFacultyId(match.id);
        } else {
            setFacultyId('fac' + Math.floor(Math.random() * 10000));
        }
    };

    const fetchExam = async () => {
        const { data, error } = await getAdminExamById(id);
        if (error) {
            alert('データの取得に失敗しました');
            navigate('/admin');
        } else if (data) {
            setExamId(data.id);
            setUniversity(data.university);
            setUniversityId(data.university_id);
            setFaculty(data.faculty);
            setFacultyId(data.faculty_id);
            setYear(data.year);
            setSubject(data.subject);
            setSubjectEn(data.subject_en);
            setType(data.type);
            setExamData({
                max_score: data.max_score,
                detailed_analysis: data.detailed_analysis,
                structure: data.structure,
                pdf_path: data.pdf_path,
                passing_lines: data.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
            });
        }
        setLoading(false);
    };

    const handleGenerate = async () => {
        const totalAnswerFiles = Object.values(answerFilesBySection).reduce((sum, arr) => sum + arr.length, 0);
        if (questionFiles.length === 0 || totalAnswerFiles === 0 || !examId) {
            alert('ID、問題ファイル、解答ファイルは少なくとも1つずつ必須です。');
            return;
        }

        setGenerating(true);
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                alert('【エラー】Gemini APIキーが設定されていません。\n\n' +
                    'ローカル環境の場合: .env.local に VITE_GEMINI_API_KEY または VITE_GEMINI_API_KEY_V2 を記述して再起動してください。\n' +
                    'Vercel環境の場合: Settings > Environment Variables に値を設定し、Redeployしてください。');
                setGenerating(false);
                return;
            }

            const result = await generateExamMasterData(
                apiKey,
                subjectEn,
                questionFiles, // Common reference
                questionFilesBySection,
                answerFilesBySection,
                sectionInstructionsBySection,
                {
                    id: examId, university, universityId: parseInt(universityId),
                    faculty, facultyId, year: parseInt(year), subject,
                    generateDetailed, maxScore: parseInt(examData?.max_score) || 100
                }
            );

            setExamData(prev => ({
                max_score: result.max_score,
                detailed_analysis: result.detailed_analysis,
                structure: result.structure,
                pdf_path: result.pdf_path,
                passing_lines: prev?.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
            }));
            alert('マスターデータの生成が完了しました！内容を確認・編集して保存してください。');
        } catch (error) {
            alert('生成中にエラーが発生しました。\n' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async () => {
        if (!examData || !examId) {
            alert('保存するデータがありません。');
            return;
        }

        setSaving(true);
        let finalPdfPath = examData.pdf_path || '';

        // If a new PDF file was selected, upload it to storage
        if (questionFiles && questionFiles.length > 0) {
            try {
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                if (publicUrl) {
                    finalPdfPath = publicUrl;
                }
            } catch (err) {
                alert('PDFのアップロードに失敗しました:\n' + err.message);
                setSaving(false);
                return;
            }
        }

        const payload = {
            id: examId,
            university,
            university_id: parseInt(universityId) || 0,
            faculty,
            faculty_id: facultyId,
            year: parseInt(year),
            subject,
            subject_en: subjectEn,
            type,
            pdf_path: finalPdfPath,
            max_score: parseInt(examData.max_score),
            detailed_analysis: examData.detailed_analysis,
            structure: examData.structure,
            passing_lines: examData.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
        };

        const { error } = await saveAdminExam(payload);
        setSaving(false);

        if (error) {
            alert('保存に失敗しました:\n' + error.message);
        } else {
            alert('保存しました！');
            // navigate('/admin'); <-- Removed to preserve local file state
        }
    };

    const handleSaveAndPreview = async () => {
        if (!examData || !examId) {
            alert('保存するデータがありません。');
            return;
        }

        setSaving(true);
        let finalPdfPath = examData.pdf_path || '';

        if (questionFiles && questionFiles.length > 0) {
            try {
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                if (publicUrl) {
                    finalPdfPath = publicUrl;
                }
            } catch (err) {
                alert('PDFのアップロードに失敗しました:\n' + err.message);
                setSaving(false);
                return;
            }
        }

        const payload = {
            id: examId,
            university,
            university_id: parseInt(universityId) || 0,
            faculty,
            faculty_id: facultyId,
            year: parseInt(year),
            subject,
            subject_en: subjectEn,
            type,
            pdf_path: finalPdfPath,
            max_score: parseInt(examData.max_score),
            detailed_analysis: examData.detailed_analysis,
            structure: examData.structure,
            passing_lines: examData.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
        };

        const { error } = await saveAdminExam(payload);
        setSaving(false);

        if (error) {
            alert('保存に失敗しました:\n' + error.message);
        } else {
            const formattedExam = {
                id: payload.id,
                university: payload.university,
                universityId: payload.university_id,
                faculty: payload.faculty,
                facultyId: payload.faculty_id,
                year: payload.year,
                subject: payload.subject,
                subjectEn: payload.subject_en,
                type: payload.type,
                pdfPath: payload.pdf_path,
                maxScore: payload.max_score,
                detailedAnalysis: payload.detailed_analysis,
                structure: payload.structure,
                passingLines: payload.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
            };
            // Open preview in a new tab to preserve the current Admin Editor state (file inputs)
            localStorage.setItem('previewExamData', JSON.stringify({
                exam: formattedExam,
                universityName: formattedExam.university,
                universityId: formattedExam.universityId
            }));
            window.open(`/exam/${formattedExam.universityId}-${formattedExam.facultyId}-preview`, '_blank');
        }
    };

    const handleStructureChange = (sectionIdx, qIdx, field, value) => {
        const newStructure = [...examData.structure];
        if (qIdx === null) {
            newStructure[sectionIdx][field] = value;
        } else {
            if (field === 'options') {
                newStructure[sectionIdx].questions[qIdx][field] = value.split(',').map(s => s.trim());
            } else {
                newStructure[sectionIdx].questions[qIdx][field] = value;
            }
        }
        setExamData({ ...examData, structure: newStructure });
    };

    const handleAddGenerationSection = () => {
        const newCount = sectionCount + 1;
        setSectionCount(newCount);
        setAnswerFilesBySection(prev => ({ ...prev, [newCount]: [] }));
        setQuestionFilesBySection(prev => ({ ...prev, [newCount]: [] }));
        setSectionInstructionsBySection(prev => ({ ...prev, [newCount]: '' }));
    };

    const handleDeleteGenerationSection = (num) => {
        if (sectionCount <= 1) return;
        if (!confirm(`第${num}問のアップロード設定を削除しますか？`)) return;

        setSectionCount(prev => prev - 1);

        // Offset the files for higher sections
        const newAnswerFiles = {};
        const newQuestionFiles = {};
        const newInstructions = {};

        let targetIdx = 1;
        for (let i = 1; i <= sectionCount; i++) {
            if (i === num) continue;
            newAnswerFiles[targetIdx] = answerFilesBySection[i] || [];
            newQuestionFiles[targetIdx] = questionFilesBySection[i] || [];
            newInstructions[targetIdx] = sectionInstructionsBySection[i] || '';
            targetIdx++;
        }

        setAnswerFilesBySection(newAnswerFiles);
        setQuestionFilesBySection(newQuestionFiles);
        setSectionInstructionsBySection(newInstructions);
    };

    const flatAnswerFiles = Object.values(answerFilesBySection).flat();

    const handleRegenerateExplanation = async (sIdx, qIdx, q) => {
        if (!confirm(`問${q.id}の解説を再生成しますか？\n（内容が上書きされます）`)) return;

        const oldExplanation = q.explanation;
        handleStructureChange(sIdx, qIdx, 'explanation', '🔄 AI生成中...');
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;
            const newExplanation = await regenerateQuestionExplanation(
                apiKey,
                q,
                questionFilesBySection[sIdx + 1] || questionFiles, // Use section files if available
                answerFilesBySection[sIdx + 1] || []
            );
            handleStructureChange(sIdx, qIdx, 'explanation', newExplanation);
        } catch (error) {
            alert('解説の再生成に失敗しました:\n' + error.message);
            handleStructureChange(sIdx, qIdx, 'explanation', oldExplanation || '');
        }
    };

    const handleRegenerateSectionAnalysis = async (sIdx, section) => {
        if (!confirm(`第${section.id}問の全体解説を再生成しますか？\n（内容が上書きされます）`)) return;

        setGeneratingSectionAnalysis(prev => ({ ...prev, [sIdx]: true }));
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;
            const newAnalysis = await generateSectionDetailedAnalysis(
                apiKey,
                subjectEn,
                section,
                questionFilesBySection[sIdx + 1] || [],
                answerFilesBySection[sIdx + 1] || [],
                sectionInstructionsBySection[sIdx + 1] || ''
            );
            handleStructureChange(sIdx, null, 'sectionAnalysis', newAnalysis);
        } catch (error) {
            alert('大問解説の再生成に失敗しました:\n' + error.message);
        } finally {
            setGeneratingSectionAnalysis(prev => ({ ...prev, [sIdx]: false }));
        }
    };
    const handleRegenerateDetailedAnalysis = async () => {
        if (!examData) {
            alert('マスターデータが存在しません。');
            return;
        }
        if (questionFiles.length === 0 && flatAnswerFiles.length === 0) {
            alert('全体詳細解説をAIで生成するには、問題または解答のファイルを少なくとも1つアップロードしてください。');
            return;
        }
        if (!confirm('全体詳細解説をAIで再生成しますか？\n（内容が上書きされます）')) return;

        setGeneratingDetailed(true);
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                alert('【エラー】Gemini APIキーが設定されていません。');
                setGeneratingDetailed(false);
                return;
            }

            const newAnalysis = await regenerateDetailedAnalysis(
                apiKey,
                subjectEn,
                examData,
                questionFiles,
                flatAnswerFiles
            );

            setExamData(prev => ({ ...prev, detailed_analysis: newAnalysis }));
            alert('全体詳細解説を再生成しました！確認して保存してください。');
        } catch (error) {
            alert('解説の再生成に失敗しました:\n' + error.message);
        } finally {
            setGeneratingDetailed(false);
        }
    };

    const handleRegeneratePoints = async () => {
        if (!examData) {
            alert('マスターデータが存在しません。');
            return;
        }
        if (!confirm('大問・小問の構造を維持したまま、配点（points）だけをAIで再計算・再割り当てしますか？\n（指定した満点に合わせて、厳密な科目別ルールに基づき再生成されます）')) return;

        setRegeneratingPoints(true);
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                alert('【エラー】Gemini APIキーが設定されていません。');
                setRegeneratingPoints(false);
                return;
            }

            const newStructure = await regeneratePointsAllocation(
                apiKey,
                subjectEn,
                examData,
                questionFiles,
                flatAnswerFiles
            );

            setExamData(prev => ({ ...prev, structure: newStructure }));
            alert('配点の再生成が完了しました！内容を確認して保存してください。');
        } catch (error) {
            alert('配点の再生成に失敗しました:\n' + error.message);
        } finally {
            setRegeneratingPoints(false);
        }
    };

    const handleAddQuestion = (sectionIdx) => {
        const newStructure = [...examData.structure];
        const questionsLength = newStructure[sectionIdx].questions.length;
        const lastQ = newStructure[sectionIdx].questions[questionsLength - 1];
        let nextId = "new";
        if (lastQ && !isNaN(parseInt(lastQ.id))) {
            nextId = String(parseInt(lastQ.id) + 1);
        }
        newStructure[sectionIdx].questions.push({
            id: nextId,
            label: `問${nextId}`,
            points: 0,
            correctAnswer: "",
            gradingInstruction: "",
            explanation: ""
        });
        setExamData({ ...examData, structure: newStructure });
    };

    const handleDeleteQuestion = (sectionIdx, qIdx) => {
        if (!confirm('この小問を削除しますか？')) return;
        const newStructure = [...examData.structure];
        newStructure[sectionIdx].questions.splice(qIdx, 1);
        setExamData({ ...examData, structure: newStructure });
    };

    const handleAddSection = () => {
        const newStructure = [...(examData.structure || [])];
        newStructure.push({
            id: String(newStructure.length + 1),
            label: `第${newStructure.length + 1}問`,
            allocatedPoints: 0,
            sectionAnalysis: '',
            questions: []
        });
        setExamData({ ...examData, structure: newStructure });
    };

    const handleDeleteSection = (sectionIdx) => {
        if (!confirm('この大問に含まれるすべての小問も削除されます。本当に削除しますか？')) return;
        const newStructure = [...examData.structure];
        newStructure.splice(sectionIdx, 1);
        setExamData({ ...examData, structure: newStructure });
    };

    // --- CSV Export: download current structure as CSV for external AI to fill ---
    const handleCsvExport = () => {
        if (!examData?.structure?.length) {
            alert('先にAIでデータを生成してください。');
            return;
        }
        const rows = [['section_id', 'section_label', 'question_id', 'question_label', 'type', 'correct_answer', 'grading_instruction', 'points', 'explanation']];
        examData.structure.forEach(sec => {
            sec.questions.forEach(q => {
                rows.push([
                    sec.id,
                    sec.label,
                    q.id,
                    q.label,
                    q.type || 'selection',
                    q.correctAnswer || '',
                    (q.gradingInstruction || '').replace(/"/g, '""'), // escape quotes
                    q.points || 0,
                    (q.explanation || '').replace(/"/g, '""') // escape quotes
                ]);
            });
        });
        const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${examId || 'exam'}_explanations.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // --- CSV Import: read CSV and map explanations back into questions ---
    const handleCsvImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target.result;
                const lines = text.split('\n').filter(l => l.trim());
                // Skip header row
                const dataLines = lines.slice(1);
                const updates = {}; // key: `${section_id}__${question_id}` -> explanation
                dataLines.forEach(line => {
                    // Simple CSV parse (handles quoted fields)
                    const cols = [];
                    let cur = '';
                    let inQuote = false;
                    for (let i = 0; i < line.length; i++) {
                        const ch = line[i];
                        if (ch === '"') {
                            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
                            else { inQuote = !inQuote; }
                        } else if (ch === ',' && !inQuote) {
                            cols.push(cur); cur = '';
                        } else {
                            cur += ch;
                        }
                    }
                    cols.push(cur);

                    // Headers: ['section_id', 'section_label', 'question_id', 'question_label', 'type', 'correct_answer', 'grading_instruction', 'points', 'explanation']
                    if (cols.length >= 9) {
                        const [sec_id, , q_id, , , , grading_instruction, , explanation] = cols;
                        if (sec_id && q_id) {
                            updates[`${sec_id.trim()}__${q_id.trim()}`] = {
                                explanation: (explanation || '').trim(),
                                gradingInstruction: (grading_instruction || '').trim()
                            };
                        }
                    } else if (cols.length === 8) {
                        // Support old format just in case
                        const [sec_id, , q_id, , , , , explanation] = cols;
                        if (sec_id && q_id) {
                            updates[`${sec_id.trim()}__${q_id.trim()}`] = {
                                explanation: (explanation || '').trim()
                            };
                        }
                    }
                });

                const newStructure = examData.structure.map(sec => ({
                    ...sec,
                    questions: sec.questions.map(q => {
                        const key = `${sec.id}__${q.id}`;
                        if (updates[key] !== undefined) {
                            return {
                                ...q,
                                explanation: updates[key].explanation,
                                // Only update gradingInstruction if it was present in the CSV
                                ...(updates[key].gradingInstruction !== undefined ? { gradingInstruction: updates[key].gradingInstruction } : {})
                            };
                        }
                        return q;
                    })
                }));
                setExamData({ ...examData, structure: newStructure });
                alert(`CSVのインポートが完了しました。\n解説が更新された問題: ${Object.keys(updates).length}問\n\n忘れずに「保存」ボタンを押してください！`);
            } catch (err) {
                alert('CSVの読み込みに失敗しました。形式を確認してください。\n' + err.message);
            }
        };
        reader.readAsText(file, 'UTF-8');
        e.target.value = ''; // reset input
    };

    const totalAllocatedPoints = examData?.structure?.reduce((acc, section) => {
        return acc + section.questions.reduce((qAcc, q) => qAcc + (parseInt(q.points) || 0), 0);
    }, 0) || 0;

    if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8 pb-48">
            <div className="max-w-6xl mx-auto space-y-8">

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center gap-4">
                        <button onClick={() => navigate('/admin')} className="text-gray-500 hover:text-gray-900 bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center font-bold">
                            ←
                        </button>
                        <div>
                            <h1 className="text-2xl font-serif text-navy-blue">
                                {isNew ? '新規マスターデータ作成' : 'マスターデータ編集'}
                            </h1>
                            {examData && (
                                <div className={`text-xs font-bold mt-1 ${totalAllocatedPoints !== parseInt(examData?.max_score) ? 'text-red-600' : 'text-green-600'}`}>
                                    満点: {examData?.max_score} 点 / 現在の割当: {totalAllocatedPoints} 点
                                </div>
                            )}
                        </div>
                    </div>
                    {examData && (
                        <div className="flex gap-2 mt-4 md:mt-0">
                            <button onClick={handleSaveAndPreview} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors disabled:opacity-50 text-sm">
                                {saving ? '保存中...' : '保存してプレビュー'}
                            </button>
                            <button onClick={handleSave} disabled={saving} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg shadow-sm transition-colors disabled:opacity-50 text-sm">
                                {saving ? '保存中...' : 'DBに保存'}
                            </button>
                        </div>
                    )}
                </div>

                {/* タブナビゲーション */}
                {examData && (
                    <div className="flex bg-white rounded-xl shadow-sm border border-gray-200 p-1 overflow-x-auto">
                        <button onClick={() => setActiveTab('basic')} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex-1 ${activeTab === 'basic' ? 'bg-navy-blue text-white shadow' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
                            📑 基本設定
                        </button>
                        <button onClick={() => setActiveTab('ai')} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex-1 ${activeTab === 'ai' ? 'bg-navy-blue text-white shadow' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
                            🤖 AI原案生成
                        </button>
                        <button onClick={() => setActiveTab('editor')} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex-1 ${activeTab === 'editor' ? 'bg-navy-blue text-white shadow' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
                            ✏️ 設問エディタ
                        </button>
                        <button onClick={() => setActiveTab('analysis')} className={`px-4 py-2.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors flex-1 ${activeTab === 'analysis' ? 'bg-navy-blue text-white shadow' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
                            📝 詳細解説
                        </button>
                    </div>
                )}


                {/* Explanation Generation Panel */}
                {examData && activeTab === 'editor' && (
                    <div className="space-y-6 mb-8 mt-6">
                        {/* CSV Import/Export Panel (Fallback) */}
                        <details className="bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm group">
                            <summary className="text-sm font-bold text-gray-700 cursor-pointer select-none flex items-center gap-2 list-none">
                                <span className="group-open:rotate-90 transition-transform">▶</span>
                                <span className="text-xl">🛠️</span> 外部AI（ChatGPT等）を使って解説を作る場合（CSVファイル）
                            </summary>
                            <div className="mt-4 border-t pt-4">
                                <div className="text-xs text-gray-600 mb-4 space-y-4">
                                    <div>
                                        <p className="font-semibold mb-1">【使い方】</p>
                                        <ol className="list-decimal list-inside space-y-1 ml-1">
                                            <li>下の「CSVをエクスポート」でファイルをダウンロード</li>
                                            <li>ChatGPT等にPDFとCSVをアップロードし、以下のプロンプトを投げる</li>
                                            <li>AIが返したCSVを下の「解説入りCSVをインポート」からアップロード</li>
                                            <li>最後に必ず「保存」ボタンをクリック</li>
                                        </ol>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-gray-200 relative">
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                const promptText = `添付した2つのファイルを使ってください。
・PDFファイル：大学入試の問題と解答
・CSVファイル：各小問の構造データ（正解・配点が入っています）

CSVの「explanation」列を、以下の条件で埋めてください：

1. 2〜3文で簡潔に書くこと
2. なぜその正解になるのか、本文の根拠を1文で明示すること
3. 選択問題は、他の選択肢が間違っている理由を1文加えること
4. アスタリスク（*）は使わない
5. 日本語で書くこと

CSVファイルをそのまま返してください（他の列は変更しないこと）。`;
                                                navigator.clipboard.writeText(promptText);
                                                alert('プロンプトをコピーしました！ChatGPTなどに貼り付けてご利用ください。');
                                            }}
                                            className="absolute top-2 right-2 px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-[10px] font-bold transition-colors"
                                        >
                                            📋 コピー
                                        </button>
                                        <p className="font-semibold text-gray-700 mb-2 border-b pb-1">AI用コピープロンプト</p>
                                        <pre className="whitespace-pre-wrap font-sans text-[11px] leading-snug">
                                            添付した2つのファイルを使ってください。{"\n"}
                                            ・PDFファイル：大学入試の問題と解答{"\n"}
                                            ・CSVファイル：各小問の構造データ（正解・配点が入っています）{"\n"}
                                            {"\n"}
                                            CSVの「explanation」列を、以下の条件で埋めてください：{"\n"}
                                            {"\n"}
                                            1. 2〜3文で簡潔に書くこと{"\n"}
                                            2. なぜその正解になるのか、本文の根拠を1文で明示すること{"\n"}
                                            3. 選択問題は、他の選択肢が間違っている理由を1文加えること{"\n"}
                                            4. アスタリスク（*）は使わない{"\n"}
                                            5. 日本語で書くこと{"\n"}
                                            {"\n"}
                                            CSVファイルをそのまま返してください（他の列は変更しないこと）。
                                        </pre>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button onClick={handleCsvExport} className="px-4 py-2 bg-gray-600 text-white rounded-lg text-xs font-medium hover:bg-gray-700 transition-colors">
                                        📤 CSVをエクスポート
                                    </button>
                                    <label className="px-4 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors cursor-pointer">
                                        📥 解説入りCSVをインポート
                                        <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                                    </label>
                                </div>
                            </div>
                        </details>
                    </div>
                )}

                {/* 基本情報フォーム */}
                <div className={`bg-white rounded-xl shadow p-6 ${activeTab === 'basic' ? 'block' : 'hidden'}`}>
                    <h2 className="text-xl font-bold border-b pb-2 mb-4">基本情報</h2>

                    <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6 rounded shadow-sm text-sm text-blue-800">
                        <p><strong>💡 ヒント:</strong> 大学名や学部名を入力すると、過去の登録データから自動的にIDが紐付けられます。</p>
                        <p>ID（URLの一部）は、選択された情報に基づいて裏側で自動生成されます。</p>
                        {isNew && <p className="mt-1 font-mono text-xs text-blue-600">現在の生成ID: {examId}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">大学名</label>
                            <input type="text" list="uni-list" value={university} onChange={handleUniversityChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border" placeholder="例: 明治大学" />
                            <datalist id="uni-list">
                                {universitiesData.map(u => <option key={u.id} value={u.name} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">学部名</label>
                            <input type="text" list="fac-list" value={faculty} onChange={handleFacultyChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border" placeholder="例: 法学部" />
                            <datalist id="fac-list">
                                {universitiesData.find(u => u.name === university)?.faculties.map(f => <option key={f.id} value={f.name} />)}
                            </datalist>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">年度</label>
                            <input type="number" value={year} onChange={e => setYear(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">科目名 (表示用)</label>
                            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">科目ID (english, social...)</label>
                            <select value={subjectEn} onChange={e => setSubjectEn(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border">
                                <option value="english">英語 (english)</option>
                                <option value="social">社会 (social)</option>
                                <option value="math">数学 (math)</option>
                                <option value="japanese">国語 (japanese)</option>
                                <option value="science">理科 (science)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">満点 (合計配点)</label>
                            <input type="number" value={examData?.max_score || 100} onChange={e => setExamData(prev => ({ ...prev, max_score: parseInt(e.target.value) || 100 }))} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border" />
                        </div>
                    </div>

                    <div className="mt-6 border-t pt-4">
                        <h3 className="text-md font-bold mb-3 text-gray-700">合格判定ライン（最低得点）</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {['A', 'B', 'C', 'D'].map(grade => (
                                <div key={grade}>
                                    <label className="block text-sm font-medium text-gray-700">{grade}判定</label>
                                    <input
                                        type="number"
                                        value={examData?.passing_lines?.[grade] ?? ''}
                                        onChange={e => setExamData(prev => ({
                                            ...prev,
                                            passing_lines: {
                                                ...(prev?.passing_lines || { A: 80, B: 70, C: 60, D: 40 }),
                                                [grade]: parseInt(e.target.value) || 0
                                            }
                                        }))}
                                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border"
                                        placeholder={`${grade}判定の点数`}
                                    />
                                </div>
                            ))}
                        </div>
                        <p className="text-sm text-gray-500 mt-2">※ ここで設定した点数未満の場合、自動的に一つ下の判定になります（D判定未満はE判定）。デフォルトは8割でA判定などの割合計算です。</p>
                    </div>
                </div>

                {/* PDF生成 (新規時または再生成時) */}
                <div className={`bg-white rounded-xl shadow p-6 border border-accent-gold ${activeTab === 'ai' ? 'block' : 'hidden'}`}>
                    <h2 className="text-xl font-bold border-b pb-2 mb-4 text-accent-gold">AIによる自動生成</h2>
                    <p className="text-sm text-gray-600 mb-4">問題ファイルの全体と、大問ごとの解答ファイル (PDF または 画像) をアップロードして、配点・解答・解説を自動生成します。</p>

                    <div className="mb-4 flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <div>
                            <label className="block text-sm font-bold text-gray-700">大問の設定 (現在: {sectionCount}個)</label>
                            <p className="text-[10px] text-gray-500 mt-0.5">※ 問題・解答を大問ごとに分割してアップロードできます。精度向上のため推奨します。</p>
                        </div>
                        <button
                            onClick={handleAddGenerationSection}
                            className="bg-navy-blue text-white hover:bg-opacity-90 font-bold py-1.5 px-4 rounded shadow-sm text-sm transition-colors flex items-center gap-1"
                        >
                            <span className="text-lg leading-none">+</span> 大問を追加
                        </button>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 items-start border-t border-gray-100 pt-4">
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-bold text-gray-700 mb-2">共通：問題ファイル (表示用) ({questionFiles.length}個選択中)</label>
                            <input type="file" multiple accept="application/pdf,image/webp,image/jpeg,image/png" onChange={e => setQuestionFiles(Array.from(e.target.files))} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                            <p className="text-[10px] text-gray-500 mt-1">※ ここでアップロードされたファイルは、生徒用画面に表示されます。</p>
                            {questionFiles.length > 0 && <p className="text-xs text-indigo-600 mt-2 font-medium">✅ {questionFiles.map(f => f.name).join(', ')} を保持しています</p>}
                            {questionFiles.length === 0 && !isNew && examData?.pdf_path && <p className="text-xs text-gray-500 mt-2">※DB上のPDF: <a href={examData.pdf_path} target="_blank" className="underline text-blue-500">確認する</a></p>}
                        </div>
                        <div className="flex-[2] w-full bg-gray-50 p-4 rounded-lg border border-gray-200">
                            <label className="block text-sm font-bold text-gray-700 mb-2">大問ごとの設定 (AI解析用)</label>
                            <div className="space-y-6">
                                {Array.from({ length: sectionCount }).map((_, i) => (
                                    <div key={i + 1} className="space-y-3 border-b border-gray-200 pb-5 last:border-0 last:pb-0 relative group">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="bg-navy-blue text-white text-xs font-bold px-2 py-0.5 rounded-full">第{i + 1}問</span>
                                            </div>
                                            {sectionCount > 1 && (
                                                <button
                                                    onClick={() => handleDeleteGenerationSection(i + 1)}
                                                    className="text-[10px] text-red-500 hover:text-red-700 font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    この大問設定を削除
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">問題ファイル ({questionFilesBySection[i + 1]?.length || 0})</label>
                                                <input
                                                    type="file"
                                                    multiple
                                                    accept="application/pdf,image/webp,image/jpeg,image/png"
                                                    onChange={e => setQuestionFilesBySection(prev => ({ ...prev, [i + 1]: Array.from(e.target.files) }))}
                                                    className="w-full text-[10px] text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">解答ファイル ({answerFilesBySection[i + 1]?.length || 0})</label>
                                                <input
                                                    type="file"
                                                    multiple
                                                    accept="application/pdf,image/webp,image/jpeg,image/png"
                                                    onChange={e => setAnswerFilesBySection(prev => ({ ...prev, [i + 1]: Array.from(e.target.files) }))}
                                                    className="w-full text-[10px] text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-gray-600 uppercase tracking-wider">AIへの個別指示（任意）</label>
                                            <textarea
                                                value={sectionInstructionsBySection[i + 1] || ''}
                                                onChange={e => setSectionInstructionsBySection(prev => ({ ...prev, [i + 1]: e.target.value }))}
                                                placeholder="例: この大問は資料読解なので、図表の根拠を重視して解説を作ってください。"
                                                className="w-full p-2 border rounded text-xs bg-white h-12"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-col items-center justify-center border-t border-accent-gold/20 pt-6">
                        <button
                            onClick={handleGenerate}
                            disabled={generating}
                            className="bg-accent-gold hover:bg-yellow-600 text-white font-bold py-3 px-8 rounded-lg shadow-md transition-all disabled:opacity-50 text-lg flex items-center gap-2"
                        >
                            {generating ? (
                                <>
                                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    画像解析・構造構築中...
                                </>
                            ) : (
                                <>
                                    <span className="bg-yellow-600 text-xs px-2 py-1 rounded">ステップ 1</span>
                                    <span>問題構造・配点・正解のみを自動生成する</span>
                                </>
                            )}
                        </button>
                        <p className="text-sm text-gray-500 mt-3 font-medium">※ 解説は構造生成後に別途行います（APIエラー防止のため）</p>
                    </div>
                </div>

                {/* データエディタ */}
                <div className={`bg-white rounded-xl shadow p-6 ${examData && activeTab === 'editor' ? 'block' : 'hidden'}`}>
                    <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-6 rounded shadow-sm">
                        <h3 className="text-sm font-bold text-green-800">✅ PDFの自動アップロード機能</h3>
                        <p className="mt-1 text-sm text-green-700">
                            保存ボタンを押すと、選択したPDF（問題用紙）が自動的にセキュアサーバー（Supabase Storage）にアップロードされ、生徒のテスト画面で表示されるようになります。
                        </p>
                    </div>

                    <div className="mb-6 pb-2 flex items-center justify-between border-b border-gray-200">
                        <span className={`text-sm font-bold ${totalAllocatedPoints !== parseInt(examData?.max_score) ? 'text-red-600' : 'text-green-600'}`}>
                            満点: {examData?.max_score} 点 / 現在の割当合計: {totalAllocatedPoints} 点
                        </span>
                        <button
                            onClick={handleRegeneratePoints}
                            disabled={regeneratingPoints}
                            className="bg-purple-100 text-purple-700 hover:bg-purple-200 font-bold py-1.5 px-3 rounded shadow-sm text-sm border border-purple-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                            title="科目ごとの厳密なルールに基づいて、指定した満点になるよう配点（points）のみを再割り当てします。"
                        >
                            {regeneratingPoints ? (
                                <>
                                    <svg className="animate-spin h-3.5 w-3.5 text-purple-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    生成中...
                                </>
                            ) : '🤖 配点をAIで再生成'}
                        </button>
                    </div>

                    <div className="space-y-6">
                        {examData.structure.map((section, sIdx) => (
                            <div key={sIdx} className="border rounded-lg p-4 bg-gray-50">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex flex-1 items-center gap-4">
                                        <input
                                            type="text"
                                            value={section.id}
                                            onChange={e => handleStructureChange(sIdx, null, 'id', e.target.value)}
                                            className="w-24 p-1 border rounded font-bold"
                                        />
                                        <input
                                            type="text"
                                            value={section.label}
                                            onChange={e => handleStructureChange(sIdx, null, 'label', e.target.value)}
                                            className="flex-1 p-1 border rounded font-bold"
                                            placeholder="大問ラベル"
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleDeleteSection(sIdx)}
                                        className="ml-4 text-xs bg-red-50 text-red-600 hover:bg-red-100 font-bold py-1 px-3 rounded border border-red-200 transition-colors"
                                    >
                                        大問ごと削除
                                    </button>
                                </div>

                                <table className="min-w-full bg-white border border-gray-200 text-sm">
                                    <thead className="bg-gray-100 border-b">
                                        <tr>
                                            <th className="px-2 py-2 text-left w-12">ID</th>
                                            <th className="px-2 py-2 text-left w-20">ラベル</th>
                                            <th className="px-2 py-2 text-left w-20">形式</th>
                                            <th className="px-2 py-2 text-left w-24">完答グループ</th>
                                            <th className="px-2 py-2 text-left w-32">選択肢(カンマ区切り)</th>
                                            <th className="px-2 py-2 text-left w-16">配点</th>
                                            <th className="px-2 py-2 text-left w-20">正解</th>
                                            <th className="px-2 py-2 text-left w-32">採点方法(AI指示)</th>
                                            <th className="px-2 py-2 text-left">解説</th>
                                            <th className="px-2 py-2 text-center w-10">削除</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {section.questions.map((q, qIdx) => (
                                            <tr key={qIdx} className="border-b hover:bg-gray-50">
                                                <td className="px-2 py-2">
                                                    <input type="text" value={q.id} onChange={e => handleStructureChange(sIdx, qIdx, 'id', e.target.value)} className="w-full p-1 border rounded text-xs" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <input type="text" value={q.label} onChange={e => handleStructureChange(sIdx, qIdx, 'label', e.target.value)} className="w-full p-1 border rounded text-xs" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <select value={q.type || 'text'} onChange={e => handleStructureChange(sIdx, qIdx, 'type', e.target.value)} className="w-full p-1 border rounded text-xs">
                                                        <option value="text">記述</option>
                                                        <option value="selection">選択</option>
                                                        <option value="complete">完答(旧)</option>
                                                        <option value="unordered">順不同</option>
                                                        <option value="mixed">併用(マーク/記述)</option>
                                                        <option value="correction">訂正</option>
                                                    </select>
                                                </td>
                                                <td className="px-2 py-2">
                                                    <input type="text" value={q.completeGroupId || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'completeGroupId', e.target.value)} className="w-full p-1 border rounded text-xs" placeholder="A, 1 等" title="同じ文字を入力した問題同士が完答グループになります" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <input type="text" value={q.options ? q.options.join(',') : ''} onChange={e => handleStructureChange(sIdx, qIdx, 'options', e.target.value)} disabled={!['selection', 'complete', 'unordered', 'mixed'].includes(q.type)} className="w-full p-1 border rounded text-xs disabled:bg-gray-200" placeholder="a,b,c,d" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <input type="number" value={q.points} onChange={e => handleStructureChange(sIdx, qIdx, 'points', parseInt(e.target.value))} className="w-full p-1 border rounded text-xs" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <input type="text" value={q.correctAnswer} onChange={e => handleStructureChange(sIdx, qIdx, 'correctAnswer', e.target.value)} className="w-full p-1 border rounded text-xs" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <textarea value={q.gradingInstruction || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'gradingInstruction', e.target.value)} className="w-full p-1 border rounded text-xs h-16 bg-blue-50 focus:bg-white transition-colors" placeholder="例: AとB両方で正解" />
                                                </td>
                                                <td className="px-2 py-2">
                                                    <div className="flex flex-col gap-1">
                                                        <textarea value={q.explanation || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'explanation', e.target.value)} className="w-full p-1 border rounded text-xs h-16" />
                                                        <button
                                                            onClick={() => handleRegenerateExplanation(sIdx, qIdx, q)}
                                                            className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded border border-blue-200 text-center w-full"
                                                            title="この問題の解説のみをAIで再生成する"
                                                        >
                                                            解説を再生成
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-2 py-2 text-center">
                                                    <button
                                                        onClick={() => handleDeleteQuestion(sIdx, qIdx)}
                                                        className="text-red-500 hover:text-red-700 font-bold px-2 py-1 rounded border border-red-200 hover:bg-red-50"
                                                        title="小問を削除"
                                                    >×</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                <div className="mt-3 text-right">
                                    <button
                                        onClick={() => handleAddQuestion(sIdx)}
                                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-bold py-1 px-4 rounded text-sm border border-blue-200 transition-colors"
                                    >
                                        ＋ 小問を追加
                                    </button>
                                </div>

                                <div className="mt-6 border-t pt-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-sm font-bold text-gray-700">第{section.id}問 の全体解説（詳細）</label>
                                        <button
                                            onClick={() => handleRegenerateSectionAnalysis(sIdx, section)}
                                            disabled={generatingSectionAnalysis[sIdx]}
                                            className="text-xs bg-purple-50 text-purple-600 hover:bg-purple-100 font-bold py-1 px-3 rounded border border-purple-200 transition-colors flex items-center gap-1"
                                        >
                                            {generatingSectionAnalysis[sIdx] ? '🔄 生成中...' : '🤖 大問解説をAIで生成'}
                                        </button>
                                    </div>
                                    <textarea
                                        value={section.sectionAnalysis || ''}
                                        onChange={e => handleStructureChange(sIdx, null, 'sectionAnalysis', e.target.value)}
                                        placeholder="各大問ごとの詳細な読解プロセスや、全体のまとめを記述します。"
                                        className="w-full p-3 border rounded text-xs h-32 bg-white"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-6 flex justify-center">
                        <button
                            onClick={handleAddSection}
                            className="bg-white text-indigo-600 hover:bg-indigo-50 font-bold py-3 px-8 rounded-lg shadow-sm border-2 border-dashed border-indigo-200 transition-all text-sm w-full md:w-auto"
                        >
                            ＋ 新しい大問（セクション）を追加
                        </button>
                    </div>
                </div>

                <div className={`bg-white rounded-xl shadow p-6 ${examData && activeTab === 'analysis' ? 'block' : 'hidden'}`}>
                    <div className="flex justify-between items-center mb-4">
                        <label className="block text-sm font-bold text-gray-700">全体詳細解説 (Markdown)</label>
                        <button
                            onClick={handleRegenerateDetailedAnalysis}
                            disabled={generatingDetailed}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition-colors disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            {generatingDetailed ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    生成中...
                                </>
                            ) : '全体詳細解説をAIで生成する'}
                        </button>
                    </div>
                    <textarea
                        value={examData.detailed_analysis}
                        onChange={e => setExamData({ ...examData, detailed_analysis: e.target.value })}
                        className="w-full p-4 border rounded shadow-sm font-mono text-sm leading-relaxed bg-gray-50 focus:bg-white transition-colors"
                        style={{ height: '800px', resize: 'vertical', overflowY: 'scroll', display: 'block' }}
                    />
                </div>
            </div>
        </div >
    );
}

export default AdminExamEditor;
