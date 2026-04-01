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
    const [uploadingQuestion, setUploadingQuestion] = useState(false);
    const [uploadingAnswers, setUploadingAnswers] = useState({});

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
    const generateDetailed = true;

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
        const hasUploadedAnswers = (examData?.structure || []).some(s => s.answer_pdf_path);

        if (!examId) {
            alert('IDを入力してください。');
            return;
        }

        if (questionFiles.length === 0 && !examData?.pdf_path) {
            alert('問題ファイルが必要です。');
            return;
        }

        if (totalAnswerFiles === 0 && !hasUploadedAnswers) {
            alert('解答ファイルが必要です。');
            return;
        }

        setGenerating(true);
        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                alert('【エラー】Gemini APIキーが設定されていません。.env.localファイルに VITE_GEMINI_API_KEY が正しく設定されているか確認してください。設定後は、必ず開発サーバーを一度停止（Ctrl+C）してから再度起動（npm run dev）して環境変数を読み込ませてください。');
                setGenerating(false);
                return;
            }

            // Ensure files are uploaded if not already
            let finalQFiles = questionFiles;
            let finalAFiles = answerFilesBySection;

            const result = await generateExamMasterData(
                apiKey,
                subjectEn,
                finalQFiles,
                questionFilesBySection,
                finalAFiles,
                sectionInstructionsBySection,
                {
                    id: examId, university, universityId: parseInt(universityId),
                    faculty, facultyId, year: parseInt(year), subject,
                    generateDetailed, maxScore: parseInt(examData?.max_score) || 100
                }
            );

            setExamData(prev => ({
                ...prev,
                max_score: result.max_score,
                detailed_analysis: result.detailed_analysis,
                structure: result.structure.map((s, idx) => ({
                    ...s,
                    // Preserve existing PDF paths if the new structure doesn't have them
                    answer_pdf_path: prev?.structure?.[idx]?.answer_pdf_path || s.answer_pdf_path
                })),
                pdf_path: result.pdf_path || prev?.pdf_path,
                passing_lines: prev?.passing_lines || { A: Math.round(result.max_score * 0.8), B: Math.round(result.max_score * 0.7), C: Math.round(result.max_score * 0.6), D: Math.round(result.max_score * 0.4) }
            }));
            alert('マスターデータの生成が完了しました！内容を確認・編集して保存してください。');
        } catch (error) {
            alert('生成中にエラーが発生しました。\n' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async (showPrompt = true) => {
        if (!examId) {
            alert('IDを入力してください。');
            return;
        }

        setSaving(true);
        let finalPdfPath = examData?.pdf_path || '';

        // Final check/upload for main PDF if not yet done
        if (questionFiles && questionFiles.length > 0 && !finalPdfPath) {
            try {
                const { publicUrl, error: uploadError } = await uploadExamPdf(questionFiles[0], examId);
                if (uploadError) throw uploadError;
                if (publicUrl) finalPdfPath = publicUrl;
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
            max_score: parseInt(examData?.max_score || 100),
            detailed_analysis: examData?.detailed_analysis || '',
            structure: examData?.structure || [],
            passing_lines: examData?.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
        };

        const { error } = await saveAdminExam(payload);
        setSaving(false);

        if (error) {
            alert('保存に失敗しました:\n' + error.message);
        } else if (showPrompt) {
            alert('保存しました！');
        }
    };

    // Lightweight immediate upload helper
    const handleImmediateUpload = async (file, type, sectionNum = null) => {
        if (!examId) {
            alert('先に試験IDを入力（または自動生成）してください。ファイルを保存するために必要です。');
            return null;
        }

        if (type === 'question') setUploadingQuestion(true);
        else if (type === 'answer' && sectionNum) setUploadingAnswers(prev => ({ ...prev, [sectionNum]: true }));

        try {
            const { publicUrl, error } = await uploadExamPdf(file, examId);
            if (error) throw error;

            if (type === 'question') {
                setExamData(prev => ({ ...prev, pdf_path: publicUrl }));
            } else if (type === 'answer' && sectionNum !== null) {
                // Update structure if it exists, or wait for save
                setExamData(prev => {
                    const newStructure = [...(prev?.structure || [])];
                    // If structure is not yet generated, we might need to store it somewhere else
                    // For now, let's keep it in answerFilesBySection too, but we'll try to update structure
                    const sIdx = sectionNum - 1;
                    if (newStructure[sIdx]) {
                        newStructure[sIdx].answer_pdf_path = publicUrl;
                    }
                    return { ...prev, structure: newStructure };
                });
            }
            return publicUrl;
        } catch (err) {
            console.error("Immediate upload failed:", err);
            alert('アップロードに失敗しました: ' + err.message);
            return null;
        } finally {
            if (type === 'question') setUploadingQuestion(false);
            else if (type === 'answer' && sectionNum) setUploadingAnswers(prev => ({ ...prev, [sectionNum]: false }));
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



                {/* Explanation Generation Panel */}
                {examData && (
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
                <div className="bg-white rounded-xl shadow p-6">
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
                            <input
                                type="number"
                                value={examData?.max_score || 100}
                                onChange={e => {
                                    const newMax = parseInt(e.target.value) || 100;
                                    setExamData(prev => ({
                                        ...prev,
                                        max_score: newMax,
                                        // Auto-generate temporary passing lines
                                        passing_lines: {
                                            A: Math.round(newMax * 0.8),
                                            B: Math.round(newMax * 0.7),
                                            C: Math.round(newMax * 0.6),
                                            D: Math.round(newMax * 0.4)
                                        }
                                    }));
                                }}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-navy-blue focus:ring-navy-blue sm:text-sm p-2 border"
                            />
                        </div>
                    </div>

                    <div className="mt-6 border-t pt-4">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-md font-bold text-gray-700">合格判定ライン（最低得点）</h3>
                            <button
                                onClick={() => {
                                    const max = examData?.max_score || 100;
                                    setExamData(prev => ({
                                        ...prev,
                                        passing_lines: {
                                            A: Math.round(max * 0.8),
                                            B: Math.round(max * 0.7),
                                            C: Math.round(max * 0.6),
                                            D: Math.round(max * 0.4)
                                        }
                                    }));
                                }}
                                className="text-[10px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded border border-indigo-200 font-bold"
                            >
                                満点から合格ラインを一括生成
                            </button>
                        </div>
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
                <div className="bg-white rounded-xl shadow p-6 border border-accent-gold mt-8">
                    <h2 className="text-xl font-bold border-b pb-2 mb-4 text-accent-gold">AIによる自動生成</h2>
                    <p className="text-sm text-gray-600 mb-4">問題ファイルの全体と、大問ごとの解答ファイル (PDF または 画像) をアップロードして、配点・解答・解説を自動生成します。</p>

                    <div className="mb-4 flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-200">
                        <div>
                            <label className="block text-sm font-bold text-gray-700">大問の設定 (現在: {sectionCount}個)</label>
                            <p className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded border border-red-200 mt-2">
                                【ヒント】問題・解答は大問ごとに分割してアップロードすることを強く推奨します。精度が大幅に向上します。
                                <br />
                                便利な分割ツール: <a href="https://tools.pdf24.org/ja/split-pdf" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline font-black">PDF24 ( https://tools.pdf24.org/ja/split-pdf )</a>
                            </p>
                        </div>
                        <button
                            onClick={handleAddGenerationSection}
                            className="bg-navy-blue text-white hover:bg-opacity-90 font-bold py-1.5 px-4 rounded shadow-sm text-sm transition-colors flex items-center gap-1"
                        >
                            <span className="text-lg leading-none">+</span> 大問を追加
                        </button>
                    </div>

                    <div className="flex flex-col gap-6 items-start border-t border-gray-100 pt-4">
                        {/* Step 1: Main Question */}
                        <div className="w-full bg-blue-50/30 p-6 rounded-2xl border border-blue-100">
                            <label className="block text-sm font-black text-navy-blue mb-4 uppercase tracking-widest flex items-center gap-2">
                                <span className="bg-navy-blue text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                                問題・解答用紙 PDF (全体・閲覧用)
                            </label>
                            <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-4 rounded-xl border-2 border-dashed border-navy-blue/10 hover:border-navy-blue/30 transition-all">
                                <input
                                    type="file"
                                    multiple
                                    accept="application/pdf,image/*"
                                    onChange={async (e) => {
                                        const files = Array.from(e.target.files);
                                        setQuestionFiles(files);
                                        if (files[0]) {
                                            const url = await handleImmediateUpload(files[0], 'question');
                                            if (url) {
                                                console.log("Auto-saving main PDF...");
                                                setTimeout(() => handleSave(false), 500);
                                            }
                                        }
                                    }}
                                    className="flex-1 text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-black file:bg-navy-blue file:text-white hover:file:bg-navy-light cursor-pointer"
                                />
                                {uploadingQuestion && (
                                    <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 animate-pulse flex items-center gap-2">
                                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        アップロード中...
                                    </span>
                                )}
                                {!uploadingQuestion && questionFiles[0] && (
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            const url = URL.createObjectURL(questionFiles[0]);
                                            window.open(url, '_blank');
                                        }}
                                        className="text-[10px] font-black text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full border border-indigo-100 flex items-center gap-1 shadow-sm transition-colors"
                                    >
                                        👀 選択中のファイルを確認
                                    </button>
                                )}
                                {examData?.pdf_path && (
                                    <a
                                        href={examData.pdf_path}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] font-black text-navy-blue bg-white hover:bg-gray-50 px-3 py-1.5 rounded-full border border-navy-blue/20 flex items-center gap-1 shadow-sm transition-colors"
                                    >
                                        📄 保存済みファイルを表示
                                    </a>
                                )}
                            </div>
                            <p className="mt-2 text-[10px] text-gray-400 font-medium">※ 生徒画面のプレビューに使用されます。1ファイルに結合されたものを推奨します。</p>
                        </div>

                        {/* Step 2 & 3: Sections */}
                        <div className="w-full space-y-8">
                            {[...Array(sectionCount)].map((_, i) => {
                                const num = i + 1;
                                const sectionInStructure = examData?.structure?.[i];
                                return (
                                    <div key={num} className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                                        <div className="bg-indigo-50/50 px-8 py-4 flex justify-between items-center border-b border-indigo-100/50">
                                            <h3 className="text-sm font-black text-indigo-900 flex items-center gap-2">
                                                <span className="bg-accent-gold text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px]">
                                                    {num}
                                                </span>
                                                大問 {num} の解析用データ設定
                                            </h3>
                                            {sectionCount > 1 && (
                                                <button onClick={() => handleDeleteGenerationSection(num)} className="text-[10px] font-bold text-red-400 hover:text-red-600 transition-colors bg-white px-3 py-1 rounded-full border border-red-100">
                                                    削除
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-8 space-y-6">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                {/* Questions per Section */}
                                                <div className="space-y-4">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                                            問題ファイル (第{num}問のみ)
                                                        </label>
                                                        {questionFilesBySection[num]?.length > 0 && (
                                                            <span className="text-[10px] font-black text-navy-blue bg-navy-blue/5 px-2 py-0.5 rounded border border-navy-blue/10">
                                                                選択中: {questionFilesBySection[num][0].name}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <input
                                                        type="file" multiple accept="application/pdf,image/*"
                                                        onChange={(e) => setQuestionFilesBySection(prev => ({ ...prev, [num]: Array.from(e.target.files) }))}
                                                        className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:bg-gray-100 file:text-gray-600 hover:file:bg-gray-200 cursor-pointer"
                                                    />
                                                </div>

                                                {/* Answers per Section */}
                                                <div className="space-y-4">
                                                    <div className="flex justify-between items-center">
                                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                                            解答/解説ファイル (第{num}問のみ)
                                                        </label>
                                                        {uploadingAnswers[num] ? (
                                                            <span className="text-[10px] font-black text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 animate-pulse flex items-center gap-1">
                                                                アップロード中...
                                                            </span>
                                                        ) : sectionInStructure?.answer_pdf_path ? (
                                                            <a
                                                                href={sectionInStructure.answer_pdf_path}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="text-[10px] font-black text-green-600 bg-green-50 hover:bg-green-100 px-3 py-1 rounded border border-green-100 flex items-center gap-1 shadow-sm transition-colors"
                                                            >
                                                                📄 解答を表示
                                                            </a>
                                                        ) : answerFilesBySection[num]?.length > 0 ? (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    const url = URL.createObjectURL(answerFilesBySection[num][0]);
                                                                    window.open(url, '_blank');
                                                                }}
                                                                className="text-[10px] font-black text-indigo-400 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-100 flex items-center gap-1 shadow-sm transition-colors"
                                                            >
                                                                👀 選択中を確認
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                    <input
                                                        type="file" multiple accept="application/pdf,image/*"
                                                        onChange={async (e) => {
                                                            const files = Array.from(e.target.files);
                                                            setAnswerFilesBySection(prev => ({ ...prev, [num]: files }));
                                                            if (files[0]) {
                                                                const url = await handleImmediateUpload(files[0], 'answer', num);
                                                                if (url) {
                                                                    console.log(`Auto-saving section ${num} answer PDF...`);
                                                                    setTimeout(() => handleSave(false), 500);
                                                                }
                                                            }
                                                        }}
                                                        className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:bg-gray-100 file:text-gray-600 hover:file:bg-gray-200 cursor-pointer"
                                                    />
                                                </div>
                                            </div>

                                            {/* Instructions per Section */}
                                            <div className="pt-4 border-t border-gray-50">
                                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                                                    AIへの補足指示 (任意)
                                                </label>
                                                <textarea
                                                    value={sectionInstructionsBySection[num] || ''}
                                                    onChange={e => setSectionInstructionsBySection(prev => ({ ...prev, [num]: e.target.value }))}
                                                    placeholder="例: この大問は会話文なので、状況設定も含めて解説してください。"
                                                    className="w-full p-4 border border-gray-100 rounded-2xl text-xs bg-gray-50/50 focus:bg-white focus:border-indigo-200 transition-all outline-none"
                                                    rows="2"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-12 flex flex-col items-center justify-center border-t border-accent-gold/20 pt-10">
                        <button
                            onClick={handleGenerate}
                            disabled={generating}
                            className="group relative bg-accent-gold hover:bg-yellow-600 text-white font-black py-5 px-12 rounded-2xl shadow-2xl shadow-accent-gold/30 transition-all disabled:opacity-50 text-xl flex items-center gap-4 overflow-hidden"
                        >
                            <span className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></span>
                            {generating ? (
                                <>
                                    <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>AI解析・構造構築中...</span>
                                </>
                            ) : (
                                <>
                                    <span>マスター構成案を自動生成</span>
                                    <span className="text-2xl group-hover:translate-x-1 transition-transform">→</span>
                                </>
                            )}
                        </button>
                        <p className="text-[11px] text-gray-400 mt-6 font-bold flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-accent-gold rounded-full animate-pulse"></span>
                            AIが画像から配点・正解・大問構造を読み取ります
                        </p>
                    </div>
                </div>

                {/* 設問エディタ */}
                <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 mt-8">
                    <div className="bg-green-50/50 border-l-4 border-green-500 p-6 mb-8 rounded-2xl">
                        <h3 className="text-sm font-black text-green-900 flex items-center gap-2 mb-2">
                            <span className="text-xl">✅</span> PDFの自動保存機能が有効です
                        </h3>
                        <p className="text-xs text-green-700 font-medium leading-relaxed">
                            ファイルを選択すると即座にクラウドへ保存され、このエディタで詳細を編集できるようになります。
                        </p>
                    </div>

                    <div className="mb-8 pb-4 flex items-center justify-between border-b border-gray-100">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">SCORE STATUS</span>
                            <span className={`text-sm font-black ${totalAllocatedPoints !== parseInt(examData?.max_score) ? 'text-red-500' : 'text-navy-blue'}`}>
                                満点: {examData?.max_score} 点 / 現在の計: {totalAllocatedPoints} 点
                            </span>
                        </div>
                        <button
                            onClick={handleRegeneratePoints}
                            disabled={regeneratingPoints}
                            className="bg-navy-blue text-white hover:bg-navy-light font-black py-2 px-6 rounded-xl shadow-lg shadow-navy-blue/10 text-xs transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            {regeneratingPoints ? '配点再生成中...' : '🤖 配点をAIで微調整'}
                        </button>
                    </div>

                    <div className="space-y-12">
                        {examData?.structure?.map((section, sIdx) => (
                            <div key={sIdx} className="bg-gray-50/50 rounded-3xl border border-gray-200/50 p-8">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex flex-1 items-center gap-4">
                                        <div className="bg-navy-blue text-white w-10 h-10 rounded-2xl flex items-center justify-center font-black shadow-lg shadow-navy-blue/20">
                                            {section.id}
                                        </div>
                                        <input
                                            type="text"
                                            value={section.label}
                                            onChange={e => handleStructureChange(sIdx, null, 'label', e.target.value)}
                                            className="flex-1 bg-transparent text-lg font-black text-navy-blue border-b-2 border-transparent hover:border-gray-300 focus:border-navy-blue outline-none py-1 transition-all"
                                            placeholder="大問ラベル"
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleDeleteSection(sIdx)}
                                        className="text-[10px] font-black text-gray-400 hover:text-red-500 uppercase tracking-widest transition-colors"
                                    >
                                        大問を削除
                                    </button>
                                </div>

                                <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">ID</th>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">LABEL</th>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">TYPE</th>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">PTS</th>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">ANSWER</th>
                                                <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">EXPLANATION</th>
                                                <th className="px-4 py-4 text-center w-12 text-gray-400"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {section.questions.map((q, qIdx) => (
                                                <tr key={qIdx} className="hover:bg-blue-50/30 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <input type="text" value={q.id} onChange={e => handleStructureChange(sIdx, qIdx, 'id', e.target.value)} className="w-12 p-2 rounded-lg border border-gray-100 text-xs font-bold" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" value={q.label} onChange={e => handleStructureChange(sIdx, qIdx, 'label', e.target.value)} className="w-16 p-2 rounded-lg border border-gray-100 text-xs font-bold" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <select value={q.type || 'text'} onChange={e => handleStructureChange(sIdx, qIdx, 'type', e.target.value)} className="p-2 rounded-lg border border-gray-100 text-xs font-bold bg-white">
                                                            <option value="text">記述</option>
                                                            <option value="selection">選択</option>
                                                            <option value="unordered">順不同</option>
                                                        </select>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="number" value={q.points} onChange={e => handleStructureChange(sIdx, qIdx, 'points', parseInt(e.target.value))} className="w-12 p-2 rounded-lg border border-gray-100 text-xs font-black text-navy-blue" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <input type="text" value={q.correctAnswer} onChange={e => handleStructureChange(sIdx, qIdx, 'correctAnswer', e.target.value)} className="w-full min-w-[100px] p-2 rounded-lg border border-gray-100 text-xs font-bold" />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <div className="space-y-2">
                                                            <textarea value={q.explanation || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'explanation', e.target.value)} className="w-full p-2 rounded-lg border border-gray-100 text-[11px] h-12 leading-relaxed" />
                                                            <button onClick={() => handleRegenerateExplanation(sIdx, qIdx, q)} className="text-[9px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-tighter">AI解説を再生成</button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button onClick={() => handleDeleteQuestion(sIdx, qIdx)} className="text-gray-300 hover:text-red-500 transition-colors">×</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="mt-6 flex justify-between items-start">
                                    <div className="flex-1 mr-8">
                                        <div className="flex items-center justify-between mb-3">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Section Insight (AI Generated)</label>
                                            <button
                                                onClick={() => handleRegenerateSectionAnalysis(sIdx, section)}
                                                disabled={generatingSectionAnalysis[sIdx]}
                                                className="text-[9px] font-black text-purple-600 hover:text-purple-800 uppercase tracking-tighter disabled:opacity-50"
                                            >
                                                {generatingSectionAnalysis[sIdx] ? '🔄 生成中...' : '大問解析を再生成'}
                                            </button>
                                        </div>
                                        <textarea
                                            value={section.sectionAnalysis || ''}
                                            onChange={e => handleStructureChange(sIdx, null, 'sectionAnalysis', e.target.value)}
                                            className="w-full p-4 rounded-2xl border border-gray-200 text-xs h-24 bg-white"
                                            placeholder="大問全体の読解プロセス..."
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleAddQuestion(sIdx)}
                                        className="bg-white text-navy-blue hover:bg-navy-blue hover:text-white font-black py-3 px-6 rounded-xl border-2 border-navy-blue/10 transition-all text-xs"
                                    >
                                        ＋ 小問追加
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-12 flex justify-center">
                        <button
                            onClick={handleAddSection}
                            className="w-full bg-white text-navy-blue hover:bg-navy-blue/5 font-black py-6 rounded-3xl border-2 border-dashed border-gray-200 transition-all text-sm uppercase tracking-widest"
                        >
                            ＋ 大問を新規追加
                        </button>
                    </div>
                </div>

                {/* 詳細解説 */}
                <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 mt-8">
                    <div className="flex justify-between items-center mb-8">
                        <div className="flex flex-col">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">MARKDOWN EDITOR</span>
                            <span className="text-xl font-black text-navy-blue">全体詳細解説</span>
                        </div>
                        <button
                            onClick={handleRegenerateDetailedAnalysis}
                            disabled={generatingDetailed}
                            className="bg-navy-blue text-white hover:bg-navy-light font-black py-3 px-8 rounded-2xl shadow-xl shadow-navy-blue/20 transition-all disabled:opacity-50 text-sm flex items-center gap-2"
                        >
                            {generatingDetailed ? '生成中...' : '🤖 AIで解説全文を生成'}
                        </button>
                    </div>
                    <textarea
                        value={examData?.detailed_analysis}
                        onChange={e => setExamData({ ...examData, detailed_analysis: e.target.value })}
                        className="w-full p-8 border border-gray-100 rounded-3xl font-mono text-sm leading-relaxed bg-gray-50/30 focus:bg-white transition-all min-h-[800px] outline-none"
                    />
                </div>
            </div>
        </div >
    );
}

export default AdminExamEditor;
