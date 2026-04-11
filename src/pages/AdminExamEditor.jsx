import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getAdminExamById, saveAdminExam, uploadExamPdf } from '../services/adminExamService';
import { generateExamMasterData, regenerateQuestionExplanation, regenerateDetailedAnalysis, regeneratePointsAllocation, generateSectionDetailedAnalysis, generateSingleSectionData, generateSectionQuestionsExplanations } from '../services/adminGeminiService';
import { getUniversityList } from '../data/examRegistry';
import { getAdminBanners } from '../services/adminBannerService';

function AdminExamEditor() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = id === 'new';

    const [universitiesData, setUniversitiesData] = useState([]);

    const [loading, setLoading] = useState(!isNew);
    const [generating, setGenerating] = useState(false);
    const [generatingSectionData, setGeneratingSectionData] = useState({});
    const [generatingDetailed, setGeneratingDetailed] = useState(false);
    const [generatingSectionAnalysis, setGeneratingSectionAnalysis] = useState({});
    const [regeneratingPoints, setRegeneratingPoints] = useState(false);
    const [bulkGenerating, setBulkGenerating] = useState(false);
    const [banners, setBanners] = useState([]);
    
    useEffect(() => {
        const fetchBanners = async () => {
            try {
                const data = await getAdminBanners();
                setBanners(data || []);
            } catch (err) {
                console.error("Failed to fetch banners:", err);
            }
        };
        fetchBanners();
    }, []);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
    const [isBulkGeneratingSections, setIsBulkGeneratingSections] = useState(false);
    const [bulkSectionsProgress, setBulkSectionsProgress] = useState({ current: 0, total: 0 });
    const [saving, setSaving] = useState(false);
    const [uploadingQuestion, setUploadingQuestion] = useState(false);
    const [uploadingAnswers, setUploadingAnswers] = useState({});
    const [generatingExplanationsOnly, setGeneratingExplanationsOnly] = useState({});
    const [activeTab, setActiveTab] = useState('master');
    const [customLayout, setCustomLayout] = useState([]);

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
    const [durationMinutes, setDurationMinutes] = useState(60);
    const generateDetailed = true;

    // PDF/Image files
    const [questionFiles, setQuestionFiles] = useState([]);
    const [sectionCount, setSectionCount] = useState(3);
    const [questionFilesBySection, setQuestionFilesBySection] = useState({ 1: [], 2: [], 3: [] });
    const [answerFilesBySection, setAnswerFilesBySection] = useState({ 1: [], 2: [], 3: [] });
    const [sectionInstructionsBySection, setSectionInstructionsBySection] = useState({ 1: '', 2: '', 3: '' });
    const [sectionPointsBySection, setSectionPointsBySection] = useState({ 1: '', 2: '', 3: '' });

    // JSON Data
    const [examData, setExamData] = useState(isNew ? {
        max_score: 100,
        detailed_analysis: '',
        structure: [],
        pdf_path: '',
        passing_lines: { A: 80, B: 70, C: 60, D: 40 }
    } : null);



    const getGeminiApiKey = () => {
        return import.meta.env.VITE_GEMINI_API_KEY_V2 ||
            import.meta.env.VITE_GEMINI_API_KEY ||
            window._GEMINI_API_KEY;
    };

    useEffect(() => {
        getUniversityList().then(data => setUniversitiesData(data || []));
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
            setDurationMinutes(data.duration_minutes || 60);
            setExamData({
                max_score: data.max_score,
                detailed_analysis: data.detailed_analysis,
                structure: data.structure || [],
                pdf_path: data.pdf_path,
                passing_lines: data.passing_lines || { A: 80, B: 70, C: 60, D: 40 }
            });
            setCustomLayout(data.custom_layout || []);
            if (data.structure && data.structure.length > 0) {
                // Ensure at least 3 sections are shown or the stored count, whichever is higher
                const displayCount = Math.max(3, data.structure.length);
                setSectionCount(displayCount);

                // Also initialize the file and instruction maps for each section to avoid blanks
                const qMap = {};
                const aMap = {};
                const iMap = {};
                const pMap = {};

                // Initialize all slots up to displayCount
                for (let n = 1; n <= displayCount; n++) {
                    const sec = data.structure[n - 1];
                    qMap[n] = [];
                    aMap[n] = [];
                    iMap[n] = sec?.instruction || '';
                    pMap[n] = sec?.allocatedPoints || '';
                }

                setQuestionFilesBySection(qMap);
                setAnswerFilesBySection(aMap);
                setSectionInstructionsBySection(iMap);
                setSectionPointsBySection(pMap);
            }
        }
        setLoading(false);
    };

    const handleGenerateSection = async (sectionNum, silent = false) => {
        if (!examId) {
            if (!silent) alert('IDを入力してください。');
            return false;
        }

        const qFiles = questionFilesBySection[sectionNum] || [];
        const aFiles = answerFilesBySection[sectionNum] || [];
        const hasUploadedAnswers = examData?.structure?.[sectionNum - 1]?.answer_pdf_path;
        
        if (qFiles.length === 0 && !examData?.structure?.[sectionNum - 1]?.question_pdf_path && questionFiles.length === 0 && !examData?.pdf_path) {
            if (!silent) alert(`大問${sectionNum}の問題PDF、もしくは全体の問題PDFが必要です。`);
            return false;
        }

        if (aFiles.length === 0 && !hasUploadedAnswers) {
            if (!silent) alert(`大問${sectionNum}の解答PDFが必要です。`);
            return false;
        }

        const targetPoints = parseInt(sectionPointsBySection[sectionNum]);
        if (!targetPoints || isNaN(targetPoints) || targetPoints <= 0) {
            if (!silent && !confirm(`大問${sectionNum}の「目標配点」が設定されていません。\n配点はAIが自然な点数を適当に割り振ります（大問や全体の合計点が目標とズレる可能性があります）。\nよろしいですか？`)) {
                return false;
            }
        }

        setGeneratingSectionData(prev => ({ ...prev, [sectionNum]: true }));
        try {
            const apiKey = getGeminiApiKey();
            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                if (!silent) alert('【エラー】Gemini APIキーが見つかりません。');
                setGeneratingSectionData(prev => ({ ...prev, [sectionNum]: false }));
                return false;
            }

            const instruction = sectionInstructionsBySection[sectionNum];
            const finalQFiles = qFiles.length > 0 ? qFiles : questionFiles;

            const sectionResult = await generateSingleSectionData(
                apiKey,
                subjectEn,
                sectionNum,
                finalQFiles,
                aFiles,
                instruction,
                targetPoints
            );

            setExamData(prev => {
                const newStructure = [...(prev?.structure || [])];
                const sIdx = sectionNum - 1;
                
                while (newStructure.length <= sIdx) {
                    newStructure.push({ id: String(newStructure.length + 1), label: `第${newStructure.length + 1}問`, allocatedPoints: 0, sectionAnalysis: '', questions: [] });
                }

                const existingA_pdf = newStructure[sIdx].answer_pdf_path;
                const existingQ_pdf = newStructure[sIdx].question_pdf_path;

                newStructure[sIdx] = {
                    ...sectionResult,
                    answer_pdf_path: existingA_pdf,
                    question_pdf_path: existingQ_pdf
                };

                return { ...prev, structure: newStructure };
            });

            if (!silent) alert(`大問${sectionNum}の生成が完了しました！下部のエディタ（C）に内容が反映されました。`);
            return true;
        } catch (error) {
            console.error(`Section ${sectionNum} Generation failed:`, error);
            if (!silent) alert(`大問${sectionNum}の生成中にエラーが発生しました。\n` + error.message);
            return false;
        } finally {
            setGeneratingSectionData(prev => ({ ...prev, [sectionNum]: false }));
        }
    };

    const handleGenerateOnlyExplanations = async (sectionNum) => {
        const apiKey = getGeminiApiKey();
        if (!apiKey) {
            alert('Gemini API Keyが見つかりません。');
            return;
        }

        const sIdx = sectionNum - 1;
        const sectionData = examData?.structure?.[sIdx];
        if (!sectionData) {
            alert('大問の構成データが見つかりません。先にStep 1を実行するか、手動で構成を作成してください。');
            return;
        }

        setGeneratingExplanationsOnly(prev => ({ ...prev, [sectionNum]: true }));
        try {
            const qFiles = questionFilesBySection[sectionNum] || [];
            const aFiles = answerFilesBySection[sectionNum] || [];

            const result = await generateSectionQuestionsExplanations(
                apiKey,
                subjectEn,
                sectionData,
                qFiles,
                aFiles
            );

            // Merge the result back into the structure, ensuring we don't overwrite user-fixed values
            setExamData(prev => {
                const newStructure = [...(prev?.structure || [])];
                const currentSec = newStructure[sIdx];
                
                // Update questions (match by ID)
                const mergedQuestions = currentSec.questions.map(origQ => {
                    const match = result.questions?.find(newQ => newQ.id === origQ.id);
                    return {
                        ...origQ,
                        explanation: match ? match.explanation : origQ.explanation
                    };
                });

                newStructure[sIdx] = {
                    ...currentSec,
                    sectionAnalysis: result.sectionAnalysis || currentSec.sectionAnalysis,
                    questions: mergedQuestions
                };

                return { ...prev, structure: newStructure };
            });

            alert(`大問 ${sectionNum} の小問解説の生成が完了しました！`);
            // Trigger automatic save
            setTimeout(() => handleSave(false), 500);

        } catch (err) {
            console.error(err);
            alert(`生成中にエラーが発生しました: ${err.message}`);
        } finally {
            setGeneratingExplanationsOnly(prev => ({ ...prev, [sectionNum]: false }));
        }
    };

    const handleBulkGenerateSections = async () => {
        if (!examId) {
            alert('IDを入力してください。');
            return;
        }
        
        // Initial validations before bulk start
        for (let i = 1; i <= sectionCount; i++) {
            const qFiles = questionFilesBySection[i] || [];
            const aFiles = answerFilesBySection[i] || [];
            const hasUploadedAnswers = examData?.structure?.[i - 1]?.answer_pdf_path;
            
            if (qFiles.length === 0 && !examData?.structure?.[i - 1]?.question_pdf_path && questionFiles.length === 0 && !examData?.pdf_path) {
                alert(`大問${i}の問題PDF、もしくは全体の問題PDFが必要です。`);
                return;
            }
            if (aFiles.length === 0 && !hasUploadedAnswers) {
                alert(`大問${i}の解答PDFが必要です。`);
                return;
            }
        }

        if (!confirm(`全 ${sectionCount} つの大問データを順番にAI生成します。処理には時間がかかる場合があります。\nよろしいですか？`)) {
            return;
        }

        setIsBulkGeneratingSections(true);
        setBulkSectionsProgress({ current: 0, total: sectionCount });

        try {
            for (let i = 1; i <= sectionCount; i++) {
                setBulkSectionsProgress({ current: i, total: sectionCount });
                const success = await handleGenerateSection(i, true);
                
                if (!success) {
                    alert(`大問${i}の生成中にエラーが発生したため、一括処理を中断しました。`);
                    break;
                }
                
                // Rate limit spacing
                if (i < sectionCount) {
                    await new Promise(res => setTimeout(res, 3000));
                }
            }
            alert('全大問の生成が完了しました！下部のエディタ（C）に内容が反映されました。');
        } catch (error) {
            console.error("Bulk Generation error:", error);
            alert('一括生成中に予期せぬエラーが発生しました: ' + error.message);
        } finally {
            setIsBulkGeneratingSections(false);
            setBulkSectionsProgress({ current: 0, total: 0 });
        }
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
            // Use a more robust fallback for API key retrieval
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY_V2 ||
                import.meta.env.VITE_GEMINI_API_KEY ||
                window._GEMINI_API_KEY;

            if (!apiKey || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
                alert('【エラー】Gemini APIキーが見つかりません。.env.local設定またはVercelの環境変数を確認してください。');
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
                sectionPointsBySection,
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
                    answer_pdf_path: prev?.structure?.[idx]?.answer_pdf_path || s.answer_pdf_path,
                    question_pdf_path: prev?.structure?.[idx]?.question_pdf_path || s.question_pdf_path
                })),
                pdf_path: result.pdf_path || prev?.pdf_path,
                passing_lines: prev?.passing_lines || { A: Math.round(result.max_score * 0.8), B: Math.round(result.max_score * 0.7), C: Math.round(result.max_score * 0.6), D: Math.round(result.max_score * 0.4) }
            }));
            alert('マスターデータの生成が完了しました！内容を確認・編集して保存してください。');
        } catch (error) {
            console.error("AI Generation failed:", error);
            alert('生成中にエラーが発生しました。\n' + error.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleSave = async (showPrompt = true, structureOverride = null) => {
        if (!examId) {
            if (showPrompt) alert('IDを入力してください。');
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
                if (showPrompt) alert('PDFのアップロードに失敗しました:\n' + err.message);
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
            duration_minutes: parseInt(durationMinutes) || 60,
            pdf_path: finalPdfPath,
            max_score: parseInt(examData?.max_score || 100),
            detailed_analysis: examData?.detailed_analysis || '',
            structure: structureOverride || examData?.structure || [],
            passing_lines: examData?.passing_lines || { A: 80, B: 70, C: 60, D: 40 },
            custom_layout: customLayout
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
        else if (type === 'section_question' && sectionNum) setUploadingQuestion(true);

        try {
            const { publicUrl, error } = await uploadExamPdf(file, examId);
            if (error) throw error;

            // CRITICAL: Calculate the new expanded structure synchronously first
            // This prevents the "Save" call from using stale state that might truncate the array
            const currentStructure = [...(examData?.structure || [])];
            let updatedStructure = currentStructure;

            if (type === 'question') {
                setExamData(prev => ({ ...prev, pdf_path: publicUrl }));
                await handleSave(false, null); // For main PDF, we can use the default but it's safer to just save
            } else if ((type === 'answer' || type === 'section_question') && sectionNum !== null) {
                const sIdx = sectionNum - 1;
                // Pad the structure if it's shorter than the section number
                while (updatedStructure.length <= sIdx) {
                    updatedStructure.push({ 
                        id: String(updatedStructure.length + 1), 
                        label: `第${updatedStructure.length + 1}問`, 
                        allocatedPoints: 0, 
                        sectionAnalysis: '', 
                        questions: [] 
                    });
                }
                
                // Update the specific path
                if (type === 'answer') {
                    updatedStructure[sIdx].answer_pdf_path = publicUrl;
                } else {
                    updatedStructure[sIdx].question_pdf_path = publicUrl;
                }

                // Update state
                setExamData(prev => ({ ...prev, structure: updatedStructure }));
                
                // CRITICAL: Save immediately with the expanded and updated structure
                await handleSave(false, updatedStructure);
            }

            return publicUrl;
        } catch (err) {
            console.error("Immediate upload failed:", err);
            alert('アップロードに失敗しました: ' + err.message);
            return null;
        } finally {
            if (type === 'question') setUploadingQuestion(false);
            else if (type === 'answer' && sectionNum) setUploadingAnswers(prev => ({ ...prev, [sectionNum]: false }));
            else if (type === 'section_question' && sectionNum) setUploadingQuestion(false);
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
        setSectionPointsBySection(prev => ({ ...prev, [newCount]: '' }));
    };

    const handleDeleteGenerationSection = (num) => {
        if (sectionCount <= 1) return;
        if (!confirm(`第${num}問のアップロード設定を削除しますか？`)) return;

        setSectionCount(prev => prev - 1);

        // Offset the files for higher sections
        const newAnswerFiles = {};
        const newQuestionFiles = {};
        const newInstructions = {};
        const newPoints = {};

        let targetIdx = 1;
        for (let i = 1; i <= sectionCount; i++) {
            if (i === num) continue;
            newAnswerFiles[targetIdx] = answerFilesBySection[i] || [];
            newQuestionFiles[targetIdx] = questionFilesBySection[i] || [];
            newInstructions[targetIdx] = sectionInstructionsBySection[i] || '';
            newPoints[targetIdx] = sectionPointsBySection[i] || '';
            targetIdx++;
        }

        setAnswerFilesBySection(newAnswerFiles);
        setQuestionFilesBySection(newQuestionFiles);
        setSectionInstructionsBySection(newInstructions);
        setSectionPointsBySection(newPoints);

        // Crucial: also update the actual structure data to keep it in sync
        setExamData(prev => {
            const newStructure = (prev?.structure || []).filter((_, idx) => (idx + 1) !== num);
            // Re-index the remaining items' IDs and Labels to match the new order if necessary
            const reindexed = newStructure.map((sec, idx) => ({
                ...sec,
                id: String(idx + 1),
                label: `第${idx + 1}問`
            }));
            return { ...prev, structure: reindexed };
        });
    };

    const flatAnswerFiles = Object.values(answerFilesBySection).flat();

    const handleRegenerateExplanation = async (sIdx, qIdx, q) => {
        if (!confirm(`問${q.id}の解説を再生成しますか？\n（内容が上書きされます）`)) return;

        const oldExplanation = q.explanation;
        handleStructureChange(sIdx, qIdx, 'explanation', '🔄 AI生成中...');
        try {
            const apiKey = getGeminiApiKey();
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

    const handleBulkGenerateExplanations = async () => {
        if (!examData || !examData.structure) return;
        if (!confirm('全小問の解説をAIで一括生成します。これには時間がかかる場合があります。\n※すでに解説が入力されている設問はスキップされます。\nよろしいですか？')) return;

        // Build a flat list of tasks
        const tasks = [];
        examData.structure.forEach((section, sIdx) => {
            section.questions.forEach((q, qIdx) => {
                // Skip if it already has explanation
                if (!q.explanation || q.explanation.trim() === '' || q.explanation.includes('AI生成中')) {
                    tasks.push({ sIdx, qIdx, q });
                }
            });
        });

        if (tasks.length === 0) {
            alert('自動生成が必要な（解説が空欄の）設問はありません。');
            return;
        }

        setBulkGenerating(true);
        setBulkProgress({ current: 0, total: tasks.length });

        const apiKey = getGeminiApiKey();

        try {
            for (let i = 0; i < tasks.length; i++) {
                const { sIdx, qIdx, q } = tasks[i];
                setBulkProgress({ current: i + 1, total: tasks.length });
                
                // Show loading indicator
                handleStructureChange(sIdx, qIdx, 'explanation', '🔄 AI生成中...');
                
                try {
                    const newExplanation = await regenerateQuestionExplanation(
                        apiKey,
                        q,
                        questionFilesBySection[sIdx + 1] || questionFiles,
                        answerFilesBySection[sIdx + 1] || []
                    );
                    handleStructureChange(sIdx, qIdx, 'explanation', newExplanation);
                } catch (err) {
                    console.error("Error generating explanation for question", q.id, err);
                    handleStructureChange(sIdx, qIdx, 'explanation', '⚠️ AI生成エラー');
                }

                // Wait 2 seconds to prevent rate limit (unless it's the last one)
                if (i < tasks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            alert('一括生成が完了しました！');
        } catch (error) {
            alert('一括生成中にエラーが発生しました:\n' + error.message);
        } finally {
            setBulkGenerating(false);
            setBulkProgress({ current: 0, total: 0 });
        }
    };

    const handleRegenerateSectionAnalysis = async (sIdx, section) => {
        if (!confirm(`第${section.id}問の全体解説を再生成しますか？\n（内容が上書きされます）`)) return;

        setGeneratingSectionAnalysis(prev => ({ ...prev, [sIdx]: true }));
        try {
            const apiKey = getGeminiApiKey();
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
            const apiKey = getGeminiApiKey();

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
            const apiKey = getGeminiApiKey();

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
        <div className="min-h-screen bg-indigo-50/20 py-12 px-4 sm:px-6 lg:px-8 pb-32">
            <div className="max-w-7xl mx-auto">
                {/* Header Navigation Section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
                    <div className="flex flex-col gap-2">
                        <Link
                            to="/admin"
                            className="text-navy-blue/60 hover:text-navy-blue font-black text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 transition-colors mb-2"
                        >
                            <span className="w-5 h-5 rounded-full bg-navy-blue/5 flex items-center justify-center text-[10px] pb-0.5">←</span>
                            ダッシュボードに戻る
                        </Link>
                        <h1 className="text-4xl font-black text-navy-blue leading-tight">
                            {isNew ? '新規試験データの作成' : '試験内容の編集'}
                            <span className="ml-3 text-xs bg-navy-blue text-white px-3 py-1 rounded-full font-mono align-middle">
                                エディター v2.2
                            </span>
                        </h1>
                        <div className="flex gap-6 mt-4 border-b border-gray-200">
                            <span className="pb-3 px-1 border-b-2 border-navy-blue font-bold text-navy-blue text-sm">
                                試験マスター編集
                            </span>
                            <Link to="/admin/banners" className="pb-3 px-1 text-gray-400 hover:text-navy-blue font-medium text-sm transition-colors">
                                広告運用管理 (CMS)
                            </Link>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-4 md:mt-0">
                        {examData && (
                            <>
                                <button onClick={handleSaveAndPreview} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 text-sm flex items-center gap-2">
                                    {saving ? '保存中...' : '保存してプレビュー'}
                                </button>
                                <button onClick={handleSave} disabled={saving} className="bg-white hover:bg-gray-50 text-navy-blue font-bold py-3 px-6 rounded-xl shadow-sm border border-navy-blue/10 transition-all active:scale-95 disabled:opacity-50 text-sm">
                                    {saving ? '保存中...' : 'DBに保存のみ'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>



            {/* Tab Navigation */}
            <div className="flex flex-wrap gap-4 mb-10 sticky top-4 z-[40]">
                <button 
                    onClick={() => setActiveTab('master')}
                    className={`px-8 py-4 rounded-3xl font-black transition-all text-sm flex items-center gap-3 ${activeTab === 'master' ? 'bg-navy-blue text-white shadow-2xl shadow-navy-blue/30 scale-105' : 'bg-white/80 backdrop-blur-md text-gray-400 hover:text-navy-blue border border-white hover:bg-white shadow-sm'}`}
                >
                    <span className="text-xl">🛠️</span>
                    マスター設定・AI生成
                </button>
                <button 
                    onClick={() => setActiveTab('design')}
                    className={`px-8 py-4 rounded-3xl font-black transition-all text-sm flex items-center gap-3 ${activeTab === 'design' ? 'bg-navy-blue text-white shadow-2xl shadow-navy-blue/30 scale-105' : 'bg-white/80 backdrop-blur-md text-gray-400 hover:text-navy-blue border border-white hover:bg-white shadow-sm'}`}
                >
                    <span className="text-xl">🎨</span>
                    解説ページのデザイン編集
                    <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full animate-pulse">β</span>
                </button>
            </div>

            {/* Main Content Area */}
            {activeTab === 'master' ? (
                <div className="grid grid-cols-1 gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Explanation Generation Panel */}
                {examData && (
                    <div className="space-y-6">
                        {/* CSV Import/Export Panel (Fallback) */}
                        <details className="bg-white/50 backdrop-blur-sm border border-white rounded-3xl p-6 shadow-sm group transition-all">
                            <summary className="text-sm font-black text-navy-blue/60 cursor-pointer select-none flex items-center gap-3 list-none">
                                <span className="group-open:rotate-90 transition-transform bg-navy-blue/5 w-6 h-6 rounded-full flex items-center justify-center text-[10px]">▶</span>
                                <span className="text-xl">🛠️</span> 外部AI（ChatGPT等）を使って解説を作る場合（CSV連携）
                            </summary>
                            <div className="mt-6 pt-6 border-t border-navy-blue/5 space-y-6">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="text-xs text-gray-500 space-y-4">
                                        <p className="font-black text-navy-blue uppercase tracking-widest text-[10px]">Workflow</p>
                                        <ol className="space-y-3">
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">1</span> 「CSVをエクスポート」で構造データを取得</li>
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">2</span> AIにPDFとCSVを渡し、右のプロンプトで解説生成を依頼</li>
                                            <li className="flex gap-3"><span className="font-mono text-navy-blue bg-navy-blue/5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0">3</span> AIが返したCSVを「インポート」して保存</li>
                                        </ol>
                                        <div className="flex gap-3 pt-2">
                                            <button onClick={handleCsvExport} className="px-5 py-2.5 bg-navy-blue text-white rounded-xl text-xs font-black shadow-lg shadow-navy-blue/20 hover:bg-navy-light transition-all">
                                                📤 CSVをエクスポート
                                            </button>
                                            <label className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-xs font-black shadow-lg shadow-green-200 hover:bg-green-700 transition-all cursor-pointer">
                                                📥 解説入りCSVをインポート
                                                <input type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="bg-navy-blue/5 p-5 rounded-2xl border border-navy-blue/10 relative group/prompt">
                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                const promptText = `添付した2つのファイルを使ってください。\n・PDFファイル：大学入試の問題と解答\n・CSVファイル：各小問の構造データ\n\nCSVの「explanation」列を、以下の条件で埋めてください：\n1. 2〜3文で簡潔に書くこと\n2. 本文の根拠を1文で明示すること\n3. 選択問題は誤答の理由も1文明示すること\n4. 日本語で書き、装飾記号は使わないこと\n\nCSVファイルを修正せず、そのままの形式で返してください。`;
                                                navigator.clipboard.writeText(promptText);
                                                alert('プロンプトをコピーしました！');
                                            }}
                                            className="absolute top-4 right-4 px-3 py-1.5 bg-white text-navy-blue rounded-lg text-[10px] font-black shadow-sm opacity-0 group-hover/prompt:opacity-100 transition-all hover:bg-navy-blue hover:text-white"
                                        >
                                            📋 プロンプトをコピー
                                        </button>
                                        <p className="font-black text-navy-blue/40 text-[10px] uppercase tracking-widest mb-3">AIコピペ用プロンプト</p>
                                        <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-navy-blue/80">
                                            添付した2つのファイルを使ってください。... (PDFとCSVを読み込ませて解説を生成させる指示)
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </div>
                )}

                {/* Basic Info Panel */}
                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100">
                    <div className="flex items-center justify-between mb-8">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">A</span>
                            基本情報の設定
                        </h2>
                        <div className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-xs font-black border border-indigo-100">
                            ID: {examId || '(未生成)'}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">大学名</label>
                            <input type="text" list="uni-list" value={university} onChange={handleUniversityChange} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 明治大学" />
                            <datalist id="uni-list">
                                {universitiesData.map(u => <option key={u.id} value={u.name} />)}
                            </datalist>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">学部名</label>
                            <input type="text" list="fac-list" value={faculty} onChange={handleFacultyChange} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 法学部" />
                            <datalist id="fac-list">
                                {universitiesData.find(u => u.name === university)?.faculties.map(f => <option key={f.id} value={f.name} />)}
                            </datalist>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">年度</label>
                            <input type="number" value={year} onChange={e => setYear(e.target.value)} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">表示用科目名</label>
                            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-bold" placeholder="例: 英語" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">科目ID（内部用）</label>
                            <select value={subjectEn} onChange={e => setSubjectEn(e.target.value)} className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black appearance-none">
                                <option value="english">英語 (english)</option>
                                <option value="social">社会 (social)</option>
                                <option value="math">数学 (math)</option>
                                <option value="japanese">国語 (japanese)</option>
                                <option value="science">理科 (science)</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">満点（合計）</label>
                            <input
                                type="number"
                                value={examData?.max_score || 100}
                                onChange={e => {
                                    const newMax = parseInt(e.target.value) || 100;
                                    setExamData(prev => ({
                                        ...prev,
                                        max_score: newMax,
                                        passing_lines: {
                                            A: Math.round(newMax * 0.8),
                                            B: Math.round(newMax * 0.7),
                                            C: Math.round(newMax * 0.6),
                                            D: Math.round(newMax * 0.4)
                                        }
                                    }));
                                }}
                                className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black text-indigo-600"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">制限時間（分）</label>
                            <input
                                type="number"
                                min="1"
                                value={durationMinutes}
                                onChange={e => setDurationMinutes(e.target.value)}
                                className="block w-full rounded-2xl border-gray-100 shadow-sm focus:border-navy-blue focus:ring-navy-blue text-sm p-4 border bg-gray-50/30 focus:bg-white transition-all font-black text-amber-600"
                            />
                        </div>
                    </div>

                    <div className="mt-10 pt-10 border-t border-gray-50 space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-navy-blue tracking-tight">合格判定ボーダーライン設定</h3>
                            <button
                                onClick={() => {
                                    const max = examData?.max_score || 100;
                                    setExamData(prev => ({
                                        ...prev,
                                        passing_lines: {
                                            A: Math.round(max * 0.8), B: Math.round(max * 0.7), C: Math.round(max * 0.6), D: Math.round(max * 0.4)
                                        }
                                    }));
                                }}
                                className="text-[9px] font-black bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white px-3 py-1.5 rounded-lg border border-indigo-100 transition-all uppercase tracking-widest"
                            >
                                満点から自動計算
                            </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                            {['A', 'B', 'C', 'D'].map(grade => (
                                <div key={grade} className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                                    <label className="block text-[10px] font-black text-gray-400 mb-2">{grade} 判定 (以上)</label>
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
                                        className="w-full bg-transparent text-lg font-black text-navy-blue border-none p-0 focus:ring-0"
                                        placeholder="0"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>


                {/* AI Generation Section */}
                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-amber-100 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 relative z-10">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-accent-gold text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-amber-200">B</span>
                            AI構造解析・自動生成
                        </h2>
                        <button
                            onClick={handleAddGenerationSection}
                            className="bg-navy-blue hover:bg-navy-light text-white font-black py-2.5 px-6 rounded-xl shadow-lg transition-all text-xs flex items-center gap-2"
                        >
                            <span className="text-lg leading-none">+</span> 大問を追加
                        </button>
                    </div>

                    <div className="space-y-8 relative z-10">
                        {/* PDF Tools Notice */}
                        <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-200/50 flex items-start gap-3">
                            <span className="text-amber-600 mt-0.5">💡</span>
                            <div className="text-xs text-amber-900 leading-relaxed font-bold">
                                PDFのファイルサイズが大きすぎる場合や、余分なページが含まれている場合は、<br className="hidden md:block" />
                                <a href="https://tools.pdf24.org/ja/split-pdf" target="_blank" rel="noopener noreferrer" className="text-navy-blue hover:text-indigo-600 underline decoration-indigo-300 underline-offset-4 transition-colors">
                                    PDF24 Tools (無料PDF分割ツール)
                                </a> などの外部サービスを使って、必要なページだけを分割してからアップロードしてください。
                            </div>
                        </div>

                        {/* Step 1: Main PDF */}
                        <div className="bg-indigo-50/30 p-8 rounded-3xl border border-indigo-100">
                            <label className="block text-[10px] font-black text-navy-blue/40 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 bg-navy-blue rounded-full"></span>
                                Step 1: 全体PDFアップロード
                            </label>
                            <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-5 rounded-2xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 transition-all group">
                                <input
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={async (e) => {
                                        const files = Array.from(e.target.files);
                                        setQuestionFiles(files);
                                        if (files[0]) {
                                            await handleImmediateUpload(files[0], 'question');
                                        }
                                    }}
                                    className="flex-1 text-xs text-gray-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:bg-navy-blue file:text-white hover:file:bg-navy-light cursor-pointer"
                                />
                                {uploadingQuestion && (
                                    <div className="flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 animate-pulse">
                                        <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-[10px] font-black text-indigo-500">保存中...</span>
                                    </div>
                                )}
                                {questionFiles[0] && (
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            window.open(URL.createObjectURL(questionFiles[0]), '_blank');
                                        }}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[10px] font-black transition-all"
                                    >
                                        👀 選択中のファイルを確認
                                    </button>
                                )}
                                {examData?.pdf_path && (
                                    <a
                                        href={examData.pdf_path}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-xl text-[10px] font-black border border-navy-blue/10 transition-all"
                                    >
                                        📄 保存済みファイルを表示
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Section Uploads */}
                        <div className="space-y-6">
                            {[...Array(sectionCount)].map((_, i) => {
                                const num = i + 1;
                                const sectionInStructure = examData?.structure?.[i];
                                return (
                                    <div key={num} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div className="bg-gray-50/50 px-8 py-4 flex justify-between items-center border-b border-gray-100/50">
                                            <h3 className="text-xs font-black text-navy-blue flex items-center gap-3">
                                                <span className="bg-navy-blue text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px]">
                                                    {num}
                                                </span>
                                                大問 {num} の解析用データ
                                            </h3>
                                            {sectionCount > 1 && (
                                                <button onClick={() => handleDeleteGenerationSection(num)} className="text-[10px] font-black text-red-300 hover:text-red-500 transition-colors">
                                                    削除
                                                </button>
                                            )}
                                        </div>
                                        <div className="p-8 space-y-8">
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                                {/* Q Files */}
                                                <div className="space-y-3">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex justify-between">
                                                        大問 {num} の問題PDF/画像
                                                        {questionFilesBySection[num]?.length > 0 && <span className="text-navy-blue bg-navy-blue/5 px-2 rounded">選択中</span>}
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="file" multiple accept="application/pdf,image/*"
                                                            onChange={async (e) => {
                                                                const files = Array.from(e.target.files);
                                                                setQuestionFilesBySection(prev => ({ ...prev, [num]: files }));
                                                                if (files.length > 0) {
                                                                    await handleImmediateUpload(files[0], 'section_question', num);
                                                                }
                                                            }}
                                                            className="flex-1 text-[10px] text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-50 file:text-[10px] file:font-black file:text-gray-500 hover:file:bg-gray-100 transition-all"
                                                        />
                                                        {questionFilesBySection[num]?.[0] && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    window.open(URL.createObjectURL(questionFilesBySection[num][0]), '_blank');
                                                                }}
                                                                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black transition-all"
                                                            >
                                                                👀 プレビュー
                                                            </button>
                                                        )}
                                                        {sectionInStructure?.question_pdf_path && (
                                                            <a href={sectionInStructure.question_pdf_path} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-lg text-[9px] font-black border border-navy-blue/10 transition-all">
                                                                📄 保存済みファイルを表示
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                                {/* A Files */}
                                                <div className="space-y-3">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest flex justify-between">
                                                        大問 {num} の解答PDF/画像
                                                        {uploadingAnswers[num] ? <span className="text-indigo-500 animate-pulse">保存中...</span> : sectionInStructure?.answer_pdf_path ? <span className="text-green-600">保存済み</span> : null}
                                                    </label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <input
                                                            type="file" multiple accept="application/pdf,image/*"
                                                            onChange={async (e) => {
                                                                const files = Array.from(e.target.files);
                                                                setAnswerFilesBySection(prev => ({ ...prev, [num]: files }));
                                                                if (files[0]) {
                                                                    await handleImmediateUpload(files[0], 'answer', num);
                                                                }
                                                            }}
                                                            className="flex-1 text-[10px] text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-50 file:text-[10px] file:font-black file:text-gray-500 hover:file:bg-gray-100 transition-all"
                                                        />
                                                        {answerFilesBySection[num]?.[0] && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    window.open(URL.createObjectURL(answerFilesBySection[num][0]), '_blank');
                                                                }}
                                                                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-[9px] font-black transition-all"
                                                            >
                                                                👀 プレビュー
                                                            </button>
                                                        )}
                                                        {sectionInStructure?.answer_pdf_path && (
                                                            <a href={sectionInStructure.answer_pdf_path} target="_blank" rel="noopener noreferrer" className="px-3 py-2 bg-navy-blue/5 text-navy-blue hover:bg-navy-blue/10 rounded-lg text-[9px] font-black border border-navy-blue/10 transition-all">
                                                                📄 保存済みファイルを表示
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="pt-6 border-t border-gray-50 flex flex-col md:flex-row gap-6">
                                                <div className="flex-1">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">大問の配点（AI目標値）</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={sectionPointsBySection[num] || ''}
                                                        onChange={e => setSectionPointsBySection(prev => ({ ...prev, [num]: e.target.value }))}
                                                        placeholder="例: 20"
                                                        className="w-full p-4 rounded-2xl border border-gray-100 text-xs bg-gray-50/30 focus:bg-white focus:border-indigo-100 transition-all font-black outline-none"
                                                    />
                                                </div>
                                                <div className="flex-[2]">
                                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">AI解析用の追加指示（オプション）</label>
                                                    <textarea
                                                        value={sectionInstructionsBySection[num] || ''}
                                                    onChange={e => setSectionInstructionsBySection(prev => ({ ...prev, [num]: e.target.value }))}
                                                    placeholder="例: この大問は会話文なので、状況設定も含めて解説してください。"
                                                    className="w-full p-4 rounded-2xl border border-gray-100 text-xs bg-gray-50/30 focus:bg-white focus:border-indigo-100 transition-all outline-none min-h-[60px]"
                                                />
                                                </div>
                                            </div>
                                            <div className="px-8 pb-8 pt-4">
                                                <button
                                                    onClick={() => handleGenerateSection(num)}
                                                    disabled={generatingSectionData[num] || generating}
                                                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 px-6 rounded-xl shadow-lg transition-all text-sm flex items-center justify-center gap-3 disabled:opacity-50"
                                                >
                                                    {generatingSectionData[num] ? (
                                                        <>
                                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                                            <span>（大問 {num}）解答・配点・解説をAI生成中...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl">🪄</span>
                                                            この大問のデータ（解答構造・配点・解説）をAI生成する
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => handleGenerateOnlyExplanations(num)}
                                                    disabled={generatingExplanationsOnly[num] || generating}
                                                    className="w-full mt-3 bg-white text-indigo-600 hover:bg-indigo-50 border-2 border-indigo-200 font-black py-4 px-6 rounded-xl transition-all text-sm flex items-center justify-center gap-3 disabled:opacity-50"
                                                >
                                                    {generatingExplanationsOnly[num] ? (
                                                        <>
                                                            <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"></div>
                                                            <span>（大問 {num}）解説のみを生成中...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl">✍️</span>
                                                            「小問解説のみ」を一括生成する（構造は維持）
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="pt-10 flex flex-col items-center border-t border-indigo-50 mt-8">
                            <div className="bg-gradient-to-br from-indigo-50/50 to-white p-8 rounded-3xl border border-indigo-100 max-w-2xl w-full text-center space-y-6 shadow-sm">
                                <h4 className="text-lg font-black text-navy-blue flex items-center justify-center gap-3">
                                    <span className="text-2xl">✨</span>全大問一括処理
                                </h4>
                                <p className="text-xs text-gray-500 font-bold leading-relaxed max-w-md mx-auto">
                                    上記で設定した各大問ファイルと目標配点をもとに、すべての大問データを順番にAI生成します。<br/>
                                    <span className="text-red-400 font-black mt-2 block">※すでに生成済みのデータがある場合は上書きされます。</span>
                                </p>
                                <button
                                    onClick={handleBulkGenerateSections}
                                    disabled={isBulkGeneratingSections || generating || Object.values(generatingSectionData).some(v => v)}
                                    className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-navy-blue hover:from-indigo-700 hover:to-navy-light text-white font-black py-4 px-10 rounded-2xl shadow-xl shadow-indigo-200 transition-all text-sm disabled:opacity-50 flex items-center justify-center gap-3 mx-auto"
                                >
                                    {isBulkGeneratingSections ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                            <span>全大問を一括生成中... ({bulkSectionsProgress.current}/{bulkSectionsProgress.total})</span>
                                        </>
                                    ) : (
                                        '🚀 全ての大問を一括生成する'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Question Editor Section */}
                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100" id="editor-main">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">C</span>
                            設問内容・配点の編集
                        </h2>
                        <div className="flex flex-wrap items-center gap-2 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                            <div className="px-4 py-2">
                                <span className="text-[10px] font-black text-gray-400 uppercase block leading-none mb-1">合計配点</span>
                                <span className={`text-sm font-black ${totalAllocatedPoints !== (parseInt(examData?.max_score) || 100) ? 'text-red-500' : 'text-navy-blue'}`}>
                                    {totalAllocatedPoints} / {examData?.max_score || 100} 点
                                </span>
                            </div>
                            <button
                                onClick={handleRegeneratePoints}
                                disabled={regeneratingPoints || bulkGenerating}
                                className="bg-navy-blue text-white hover:bg-navy-light font-black py-3 px-4 rounded-xl shadow-lg transition-all text-xs disabled:opacity-50"
                            >
                                {regeneratingPoints ? '再計算中...' : '🤖 配点自動調整'}
                            </button>
                            <button
                                onClick={handleBulkGenerateExplanations}
                                disabled={bulkGenerating || regeneratingPoints}
                                className="bg-indigo-600 text-white hover:bg-indigo-700 font-black py-3 px-4 rounded-xl shadow-lg transition-all text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ minWidth: '160px' }}
                            >
                                {bulkGenerating ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        <span>生成中 ({bulkProgress.current}/{bulkProgress.total})</span>
                                    </>
                                ) : (
                                    '✨ 全解説を一括作成'
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-12">
                        {examData?.structure?.map((section, sIdx) => (
                            <div key={sIdx} className="bg-gray-50/30 rounded-[2rem] border border-gray-100 p-8 hover:bg-gray-50/50 transition-all">
                                <div className="flex items-center justify-between mb-8">
                                    <div className="flex flex-1 items-center gap-5">
                                        <div className="bg-navy-blue text-white w-12 h-12 rounded-2xl flex items-center justify-center font-black shadow-xl shadow-navy-blue/10 text-lg">
                                            {section.id}
                                        </div>
                                        <input
                                            type="text"
                                            value={section.label}
                                            onChange={e => handleStructureChange(sIdx, null, 'label', e.target.value)}
                                            className="flex-1 bg-transparent text-xl font-black text-navy-blue border-b border-transparent focus:border-navy-blue/10 outline-none pb-1 transition-all"
                                            placeholder="大問ラベル"
                                        />
                                    </div>
                                    <button onClick={() => handleDeleteSection(sIdx)} className="text-[10px] font-black text-red-200 hover:text-red-500 transition-colors">大問を削除</button>
                                </div>

                                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50/50 border-b border-gray-50">
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">ID</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">ラベル</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">形式</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">配点</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">正解</th>
                                                <th className="px-6 py-4 text-[9px] font-black text-gray-400 uppercase tracking-widest">解説・採点基準</th>
                                                <th className="px-6 py-4 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50">
                                            {section.questions.map((q, qIdx) => (
                                                <tr key={qIdx} className="hover:bg-indigo-50/20 transition-colors">
                                                    <td className="px-6 py-4"><input type="text" value={q.id} onChange={e => handleStructureChange(sIdx, qIdx, 'id', e.target.value)} className="w-12 p-3 rounded-xl border border-gray-100 text-xs font-black bg-gray-50/30" /></td>
                                                    <td className="px-6 py-4"><input type="text" value={q.label} onChange={e => handleStructureChange(sIdx, qIdx, 'label', e.target.value)} className="w-16 p-3 rounded-xl border border-gray-100 text-xs font-bold" /></td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex flex-col gap-2">
                                                            <select value={q.type || 'text'} onChange={e => handleStructureChange(sIdx, qIdx, 'type', e.target.value)} className="w-[110px] p-3 rounded-xl border border-gray-100 text-xs font-bold bg-white outline-none focus:border-navy-blue/30">
                                                                <option value="text">記述</option>
                                                                <option value="selection">選択</option>
                                                                <option value="unordered">順不同</option>
                                                            </select>
                                                            {['selection', 'unordered'].includes(q.type) && (
                                                                <input 
                                                                    type="text" 
                                                                    value={Array.isArray(q.options) ? q.options.join(',') : (q.options || '')} 
                                                                    onChange={e => handleStructureChange(sIdx, qIdx, 'options', e.target.value)} 
                                                                    placeholder="選択肢(カンマ区切り)" 
                                                                    className="w-full min-w-[110px] p-2 rounded-lg border border-gray-100 text-[10px] bg-white outline-none focus:border-navy-blue/30 transition-all shadow-sm" 
                                                                    title="カンマ区切りで入力（例: a,b,c,d）"
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4"><input type="number" value={q.points} onChange={e => handleStructureChange(sIdx, qIdx, 'points', parseInt(e.target.value) || 0)} className="w-14 p-3 rounded-xl border border-gray-100 text-xs font-black text-indigo-600 bg-indigo-50/30" /></td>
                                                    <td className="px-6 py-4"><input type="text" value={q.correctAnswer} onChange={e => handleStructureChange(sIdx, qIdx, 'correctAnswer', e.target.value)} className="w-full min-w-[120px] p-3 rounded-xl border border-gray-100 text-xs font-bold" /></td>
                                                    <td className="px-6 py-4 space-y-4">
                                                        <div className="space-y-2">
                                                            <div className="flex justify-between">
                                                                <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">解説</span>
                                                                <button onClick={() => handleRegenerateExplanation(sIdx, qIdx, q)} className="text-[9px] font-black text-indigo-400 hover:text-indigo-600 transition-colors">AIで再生成</button>
                                                            </div>
                                                            <textarea value={q.explanation || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'explanation', e.target.value)} className="w-full p-4 rounded-xl border border-gray-100 text-[11px] leading-relaxed min-h-[60px] focus:bg-gray-50/30 outline-none transition-all" />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">採点基準・指示</span>
                                                            <textarea value={q.gradingInstruction || ''} onChange={e => handleStructureChange(sIdx, qIdx, 'gradingInstruction', e.target.value)} placeholder="例: 部分点5点とする基準..." className="w-full p-4 rounded-xl border border-navy-blue/5 text-[10px] leading-relaxed min-h-[40px] bg-navy-blue/5 outline-none" />
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center"><button onClick={() => handleDeleteQuestion(sIdx, qIdx)} className="text-gray-200 hover:text-red-400 transition-colors text-lg">×</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex flex-col lg:flex-row gap-8 items-start">
                                    <div className="flex-1 w-full">
                                        <div className="flex justify-between items-center mb-3">
                                            <div className="flex items-center gap-4">
                                                <label className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em]">大問全体の分析 (AI用)</label>
                                                {subjectEn === 'english' && (
                                                    <select
                                                        value={section.questionType || 'default'}
                                                        onChange={e => handleStructureChange(sIdx, null, 'questionType', e.target.value)}
                                                        className="p-1 px-2 rounded-md border border-gray-200 text-[10px] font-black text-navy-blue outline-none cursor-pointer"
                                                    >
                                                        <option value="default">自動 (長文問題)</option>
                                                        <option value="grammar">文法・語彙問題</option>
                                                        <option value="writing">英作文問題</option>
                                                        <option value="conversation">会話文問題</option>
                                                    </select>
                                                )}
                                            </div>
                                            <button onClick={() => handleRegenerateSectionAnalysis(sIdx, section)} disabled={generatingSectionAnalysis[sIdx]} className="text-[10px] font-black text-purple-500 hover:text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-all flex items-center gap-1.5">
                                                {generatingSectionAnalysis[sIdx] ? '再生成中...' : '✨ AIで解説生成'}
                                            </button>
                                        </div>
                                        <textarea value={section.sectionAnalysis || ''} onChange={e => handleStructureChange(sIdx, null, 'sectionAnalysis', e.target.value)} className="w-full p-5 rounded-2xl border border-gray-100 text-xs bg-white focus:bg-gray-50/30 outline-none transition-all min-h-[100px]" placeholder="この大問全体の読解ポイント..." />
                                    </div>
                                    <button onClick={() => handleAddQuestion(sIdx)} className="w-full lg:w-auto px-8 py-4 bg-white hover:bg-navy-blue hover:text-white text-navy-blue font-black rounded-2xl border-2 border-navy-blue/10 transition-all text-xs whitespace-nowrap">＋ 小問を追加</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-12">
                        <button onClick={handleAddSection} className="w-full py-8 bg-gray-50/50 hover:bg-gray-50 text-gray-400 hover:text-navy-blue font-black rounded-[2rem] border-2 border-dashed border-gray-200 hover:border-navy-blue/30 transition-all text-sm tracking-[0.3em] uppercase">
                            ＋ 大問を追加
                        </button>
                    </div>
                </div>

                {/* Full Analysis Section */}
                <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100/50 p-10 border border-gray-100">
                    <div className="flex justify-between items-center mb-10">
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="bg-navy-blue text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-lg shadow-navy-blue/20">D</span>
                            合計詳細解説（マークダウン）
                        </h2>
                        <button
                            onClick={handleRegenerateDetailedAnalysis}
                            disabled={generatingDetailed}
                            className="bg-navy-blue hover:bg-navy-light text-white font-black py-4 px-10 rounded-2xl shadow-xl shadow-navy-blue/20 transition-all active:scale-[0.98] disabled:opacity-50 text-xs flex items-center gap-2"
                        >
                            {generatingDetailed ? '生成中...' : '🤖 全体解説を一括生成'}
                        </button>
                    </div>
                    <div className="bg-navy-blue/[0.02] rounded-[2rem] p-8 border border-navy-blue/5">
                        <textarea
                            value={examData?.detailed_analysis}
                            onChange={e => setExamData({ ...examData, detailed_analysis: e.target.value })}
                            className="w-full bg-transparent font-mono text-[13px] leading-relaxed text-navy-blue/80 min-h-[800px] outline-none resize-y"
                            placeholder="# 全体解説を入力..."
                        />
                    </div>
                </div>

                </div>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <BlockDesigner 
                        layout={customLayout} 
                        setLayout={setCustomLayout} 
                        examData={examData}
                        onSave={() => handleSave(true)}
                    />
                </div>
            )}
        </div>
    );
}

const BlockDesigner = ({ layout, setLayout, examData, onSave }) => {
    const importFromMaster = () => {
        if (!examData) return;
        const blocks = [];
        
        // Add Hero
        blocks.push({ id: 'hero-' + Date.now(), type: 'hero', content: {} });
        
        // Add detailed analysis
        if (examData.detailed_analysis) {
            blocks.push({ id: 'text-' + Date.now(), type: 'text', content: examData.detailed_analysis });
        }
        
        // Add sections
        examData.structure?.forEach((sec, idx) => {
            blocks.push({ id: `sec-title-${idx}-${Date.now()}`, type: 'section_analysis', content: { sectionId: sec.id, label: sec.label, text: sec.sectionAnalysis || '' } });
            blocks.push({ id: `q-list-${idx}-${Date.now()}`, type: 'question_list', content: { sectionId: sec.id } });
        });
        
        setLayout(blocks);
    };

    const addBlock = (type) => {
        const newBlock = { 
            id: type + '-' + Date.now(), 
            type, 
            content: type === 'text' ? '新しいテキストを入力...' : 
                     type === 'image' ? { url: '', alt: '' } :
                     type === 'ad' ? { pageTarget: 'result' } : {} 
        };
        setLayout([...layout, newBlock]);
    };

    const updateBlock = (index, newContent) => {
        const newLayout = [...layout];
        newLayout[index] = { ...newLayout[index], content: newContent };
        setLayout(newLayout);
    };

    const removeBlock = (index) => {
        if (!confirm('このブロックを削除してもよろしいですか？')) return;
        setLayout(layout.filter((_, i) => i !== index));
    };

    const moveBlock = (index, direction) => {
        const newLayout = [...layout];
        const target = index + direction;
        if (target < 0 || target >= layout.length) return;
        [newLayout[index], newLayout[target]] = [newLayout[target], newLayout[index]];
        setLayout(newLayout);
    };

    return (
        <div className="space-y-8">
            <div className="bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-indigo-100/50 border border-gray-100">
                <div className="flex justify-between items-center mb-10">
                    <div>
                        <h2 className="text-2xl font-black text-navy-blue flex items-center gap-3">
                            <span className="text-3xl">🎨</span> ページデザイナー
                        </h2>
                        <p className="text-xs text-gray-400 font-bold mt-2 uppercase tracking-widest ml-1">実際の解説画面と同じ構成でブロックを配置・編集できます</p>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={importFromMaster} className="px-6 py-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-2xl text-xs font-black transition-all border border-gray-200">
                            🔄 マスターから初期配置を生成
                        </button>
                        <button onClick={onSave} className="px-8 py-3 bg-navy-blue text-white rounded-2xl text-xs font-black shadow-xl shadow-navy-blue/20 hover:bg-navy-light transition-all flex items-center gap-2">
                            <span>💾</span> 保存する
                        </button>
                    </div>
                </div>

                {layout.length === 0 ? (
                    <div className="py-20 text-center border-4 border-dashed border-gray-100 rounded-[3rem] bg-gray-50/30">
                        <span className="text-4xl block mb-4">✨</span>
                        <p className="text-gray-400 font-black text-sm">レイアウトが空です。「マスターから初期配置を生成」を押すか、<br/>下のボタンからブロックを追加してください。</p>
                    </div>
                ) : (
                    <div className="space-y-6 max-w-4xl mx-auto">
                        {layout.map((block, idx) => (
                            <div key={block.id || idx} className="group relative bg-white border-2 border-transparent hover:border-indigo-200 rounded-3xl transition-all shadow-sm hover:shadow-xl hover:shadow-indigo-100/50">
                                {/* Block Toolbar */}
                                <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100 z-10">
                                    <button onClick={() => moveBlock(idx, -1)} className="p-2 bg-white shadow-lg rounded-xl text-gray-400 hover:text-navy-blue border border-gray-100 transition-colors">▲</button>
                                    <button onClick={() => moveBlock(idx, 1)} className="p-2 bg-white shadow-lg rounded-xl text-gray-400 hover:text-navy-blue border border-gray-100 transition-colors">▼</button>
                                    <button onClick={() => removeBlock(idx)} className="p-2 bg-white shadow-lg rounded-xl text-red-100 hover:bg-red-500 hover:text-white border border-gray-100 transition-colors">✕</button>
                                </div>

                                <div className="p-2">
                                    <div className="bg-gray-50/50 rounded-2xl p-6">
                                        <div className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <span className="bg-white w-5 h-5 rounded-md flex items-center justify-center shadow-sm text-xs">
                                                {block.type === 'text' ? 'T' : block.type === 'hero' ? '⭐' : block.type === 'section_analysis' ? '📄' : block.type === 'question_list' ? '📋' : block.type === 'image' ? '🖼️' : '📢'}
                                            </span>
                                            {block.type} Block
                                        </div>
                                        
                                        {block.type === 'text' && (
                                            <div 
                                                contentEditable 
                                                suppressContentEditableWarning
                                                onBlur={(e) => updateBlock(idx, e.target.innerText)}
                                                className="outline-none focus:ring-4 focus:ring-indigo-500/10 rounded-xl p-4 bg-white text-sm leading-relaxed whitespace-pre-wrap font-bold text-navy-blue border border-transparent focus:border-indigo-200 transition-all"
                                            >
                                                {block.content}
                                            </div>
                                        )}
                                        
                                        {block.type === 'hero' && (
                                            <div className="bg-gradient-to-r from-indigo-600 to-navy-blue h-24 rounded-2xl flex items-center justify-center text-white font-black text-xs gap-3 shadow-inner">
                                                <span className="text-2xl">🏆</span> 
                                                <div className="text-center">
                                                    <div className="opacity-60 text-[8px] uppercase tracking-tighter mb-1">Preview Component</div>
                                                    <div>スコア・合格判定ヘッダー</div>
                                                </div>
                                            </div>
                                        )}

                                        {block.type === 'section_analysis' && (
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-3">
                                                    <input 
                                                        type="text"
                                                        value={block.content.label}
                                                        onChange={(e) => updateBlock(idx, { ...block.content, label: e.target.value })}
                                                        className="bg-white border border-gray-100 rounded-lg px-3 py-1 text-xs font-black text-navy-blue shadow-sm outline-none focus:border-indigo-500 w-32"
                                                    />
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">の解説</span>
                                                </div>
                                                <textarea 
                                                    value={block.content.text}
                                                    onChange={(e) => updateBlock(idx, { ...block.content, text: e.target.value })}
                                                    className="w-full text-xs p-5 bg-white border border-gray-100 rounded-2xl min-h-[120px] outline-none font-bold text-gray-600 shadow-sm focus:border-indigo-500 transition-all"
                                                    placeholder="解説の内容を入力してください..."
                                                />
                                            </div>
                                        )}

                                        {block.type === 'question_list' && (
                                            <div className="bg-navy-blue/10 border-2 border-navy-blue/5 text-navy-blue p-6 rounded-2xl text-center">
                                                <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-2">設問リストを表示します</div>
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="text-xs font-black bg-white px-3 py-1 rounded-full shadow-sm">Section ID: {block.content.sectionId}</span>
                                                </div>
                                            </div>
                                        )}

                                        {block.type === 'image' && (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">画像URL</label>
                                                        <input 
                                                            type="text"
                                                            value={block.content.url}
                                                            onChange={(e) => updateBlock(idx, { ...block.content, url: e.target.value })}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-indigo-500"
                                                            placeholder="https://example.com/image.jpg"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">代替テキスト (alt)</label>
                                                        <input 
                                                            type="text"
                                                            value={block.content.alt}
                                                            onChange={(e) => updateBlock(idx, { ...block.content, alt: e.target.value })}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-bold text-navy-blue outline-none focus:border-indigo-500"
                                                            placeholder="画像の説明"
                                                        />
                                                    </div>
                                                </div>
                                                {block.content.url && (
                                                    <div className="mt-4 border-2 border-dashed border-gray-100 rounded-2xl overflow-hidden bg-white max-h-48 flex items-center justify-center">
                                                        <img src={block.content.url} alt={block.content.alt} className="max-w-full max-h-48 object-contain" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {block.type === 'ad' && (
                                            <div className="bg-gray-100/50 p-4 rounded-2xl border border-gray-200">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div>
                                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">① 広告配信ターゲット (自動)</div>
                                                        <select 
                                                            value={block.content.pageTarget || 'result_inline'}
                                                            onChange={(e) => updateBlock(idx, { ...block.content, pageTarget: e.target.value, bannerId: null })}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-black text-navy-blue outline-none focus:border-indigo-500"
                                                        >
                                                            <option value="all">すべて</option>
                                                            <option value="result_inline">結果画面 (インライン)</option>
                                                            <option value="result">結果画面 (全体)</option>
                                                            <option value="home">ホーム画面</option>
                                                            <option value="exam">試験画面</option>
                                                        </select>
                                                        <p className="text-[9px] text-gray-400 mt-2 italic">※特定の広告を選択した場合は無効になります</p>
                                                    </div>
                                                    <div>
                                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">② 特定の広告を指定 (手動)</div>
                                                        <select 
                                                            value={block.content.bannerId || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                updateBlock(idx, { ...block.content, bannerId: val || null });
                                                            }}
                                                            className="w-full bg-white border border-gray-100 rounded-lg px-3 py-2 text-xs font-black text-indigo-600 outline-none focus:border-indigo-500 font-mono"
                                                        >
                                                            <option value="">-- 指定なし (配信ターゲット優先) --</option>
                                                            {banners.map(b => (
                                                                <option key={b.id} value={b.id}>
                                                                    {b.is_active ? '✅' : '❌'} {b.title} ({b.id.substring(0,6)})
                                                                </option>
                                                            ))}
                                                        </select>
                                                        {block.content.bannerId && (
                                                            <div className="mt-2 text-right">
                                                                <button 
                                                                    onClick={() => updateBlock(idx, { ...block.content, bannerId: null })}
                                                                    className="text-red-400 hover:text-red-500 text-[10px] font-bold"
                                                                >
                                                                    × 指定を解除
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Add Block Menu */}
                <div className="mt-16 pt-12 border-t border-indigo-50">
                    <div className="text-center mb-8">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">新しいブロックを追加</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-4">
                        <button onClick={() => addBlock('text')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">✍️</span> 文章
                        </button>
                        <button onClick={() => addBlock('hero')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">⭐</span> 判定ヘッダー
                        </button>
                        <button onClick={() => addBlock('section_analysis')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">📄</span> 大問解説
                        </button>
                        <button onClick={() => addBlock('question_list')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">📋</span> 設問リスト
                        </button>
                        <button onClick={() => addBlock('image')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">🖼️</span> 画像
                        </button>
                        <button onClick={() => addBlock('ad')} className="px-8 py-5 bg-white border-2 border-gray-100 hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-100 rounded-[2rem] text-xs font-black transition-all flex items-center gap-4 shadow-sm group">
                            <span className="text-2xl group-hover:scale-125 transition-transform">📢</span> 広告
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminExamEditor;
