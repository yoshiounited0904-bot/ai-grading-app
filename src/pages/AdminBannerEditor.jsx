import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    AD_AUDIENCES,
    AD_SLOTS,
    canTargetByExamData,
    createBanner,
    getBannerById,
    getPageTargetForSlot,
    clampBannerWidthPercent,
    updateBanner,
    uploadBannerImage
} from '../services/adminBannerService';
import { getAdminExams } from '../services/adminExamService';

const normalizeOptionValue = (value) => String(value || '').trim();

const uniqueSortedOptions = (values) => {
    return [...new Set(values.map(normalizeOptionValue).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
};

const includeCurrentOption = (options, currentValue) => {
    const current = normalizeOptionValue(currentValue);
    if (!current || options.includes(current)) return options;
    return [current, ...options];
};

const AdminBannerEditor = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const isNew = !id;

    const [banner, setBanner] = useState({
        title: '',
        image_url: '',
        target_url: '',
        is_active: false,
        start_at: new Date().toISOString().split('T')[0],
        end_at: '',
        layout_type: 'horizontal',
        page_target: 'exam',
        slot: 'exam_pre_submit',
        slots: ['exam_pre_submit'],
        target_audience: 'all',
        priority: 50,
        width_percent: 100,
        description: '',
        button_text: '',
        university: '',
        faculty: '',
        subject: '',
        year: ''
    });

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewMode, setPreviewMode] = useState('desktop'); // 'desktop' or 'mobile'
    const [examTargetRows, setExamTargetRows] = useState([]);
    const [targetOptionsLoading, setTargetOptionsLoading] = useState(false);

    const fileInputRef = useRef(null);

    useEffect(() => {
        if (id) {
            loadBanner();
        }
    }, [id]);

    useEffect(() => {
        loadExamTargetRows();
    }, []);

    const loadExamTargetRows = async () => {
        setTargetOptionsLoading(true);
        try {
            const { data, error } = await getAdminExams();
            if (error) throw error;
            setExamTargetRows((data || [])
                .map(exam => ({
                    university: normalizeOptionValue(exam.university),
                    faculty: normalizeOptionValue(exam.faculty),
                    subject: normalizeOptionValue(exam.subject),
                    year: normalizeOptionValue(exam.year)
                }))
                .filter(row => row.university || row.faculty || row.subject || row.year));
        } catch (err) {
            console.warn('Failed to load exam target options:', err);
        } finally {
            setTargetOptionsLoading(false);
        }
    };

    const loadBanner = async () => {
        try {
            const found = await getBannerById(id);
            if (found) {
                const loadedSlots = Array.isArray(found.slots) && found.slots.length > 0
                    ? found.slots
                    : [found.slot || found.page_target || 'exam_pre_submit'];
                const editableSlots = loadedSlots.includes('all')
                    ? AD_SLOTS.map(slot => slot.value)
                    : loadedSlots;
                setBanner({
                    ...found,
                    start_at: found.start_at ? found.start_at.split('T')[0] : '',
                    end_at: found.end_at ? found.end_at.split('T')[0] : '',
                    slot: editableSlots[0] || 'exam_pre_submit',
                    slots: editableSlots,
                    target_audience: found.target_audience || 'all',
                    priority: found.priority ?? 50,
                    width_percent: clampBannerWidthPercent(found.width_percent || 100),
                    layout_type: 'horizontal',
                    description: found.description || '',
                    button_text: found.button_text || '',
                    university: found.university || '',
                    faculty: found.faculty || '',
                    subject: found.subject || '',
                    year: found.year || ''
                });
            } else {
                alert("広告が見つかりませんでした。");
                navigate('/admin/banners');
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const dataToSave = { ...banner };
            // Ensure dates are correctly formatted or null
            if (!dataToSave.end_at) dataToSave.end_at = null;
            dataToSave.start_at = null;
            dataToSave.layout_type = 'horizontal';
            dataToSave.slots = Array.isArray(dataToSave.slots) && dataToSave.slots.length > 0
                ? dataToSave.slots
                : ['exam_pre_submit'];
            dataToSave.slot = dataToSave.slots[0];
            dataToSave.page_target = getPageTargetForSlot(dataToSave.slot);
            dataToSave.priority = 50;
            dataToSave.button_text = null;
            dataToSave.width_percent = clampBannerWidthPercent(dataToSave.width_percent);

            if (!canTargetByExamData(dataToSave.slots)) {
                dataToSave.university = null;
                dataToSave.faculty = null;
                dataToSave.subject = null;
                dataToSave.year = null;
            }
            dataToSave.year = dataToSave.year ? Number(dataToSave.year) : null;
            ['description', 'university', 'faculty', 'subject'].forEach(key => {
                if (!dataToSave[key]) dataToSave[key] = null;
            });

            if (isNew) {
                await createBanner(dataToSave);
            } else {
                await updateBanner(id, dataToSave);
            }
            navigate('/admin/banners');
        } catch (err) {
            console.error("Banner save failed:", err);
            alert(`保存に失敗しました。\n\n原因: ${err.message || '不明なエラー'}\n\n新しい広告項目を使う場合は、supabase_schema_banners.sql をSupabase SQL Editorで再実行してください。`);
        } finally {
            setSaving(false);
        }
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        try {
            // WebP conversion (Client-side)
            const webpFile = await convertToWebP(file);
            const publicUrl = await uploadBannerImage(webpFile);
            setBanner({ ...banner, image_url: publicUrl });
        } catch (err) {
            console.error("Detailed Upload Error:", err);
            alert(`画像のアップロードに失敗しました: ${err.message || '通信エラー'}\n\n※ブラウザのコンソール(F12)で詳細を確認してください。`);
        } finally {
            setUploading(false);
        }
    };

    const handlePreviewResizeStart = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const resizeBox = e.currentTarget.closest('[data-banner-preview-resize-box]');
        const parent = resizeBox?.parentElement;
        if (!parent) return;

        const updateWidth = (clientX) => {
            const rect = parent.getBoundingClientRect();
            if (!rect.width) return;
            setBanner(prev => ({
                ...prev,
                width_percent: clampBannerWidthPercent(((clientX - rect.left) / rect.width) * 100)
            }));
        };

        const handlePointerMove = (moveEvent) => updateWidth(moveEvent.clientX);
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    const convertToWebP = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob((blob) => {
                        const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                            type: 'image/webp',
                            lastModified: Date.now()
                        });
                        resolve(newFile);
                    }, 'image/webp', 0.8);
                };
            };
        });
    };

    const getFacultyOptionsFor = (university) => uniqueSortedOptions(
        examTargetRows
            .filter(row => !university || row.university === university)
            .map(row => row.faculty)
    );

    const getSubjectOptionsFor = (university, faculty) => uniqueSortedOptions(
        examTargetRows
            .filter(row => (!university || row.university === university) && (!faculty || row.faculty === faculty))
            .map(row => row.subject)
    );

    const getYearOptionsFor = (university, faculty, subject) => uniqueSortedOptions(
        examTargetRows
            .filter(row =>
                (!university || row.university === university) &&
                (!faculty || row.faculty === faculty) &&
                (!subject || row.subject === subject)
            )
            .map(row => row.year)
    );

    const universityOptions = includeCurrentOption(
        uniqueSortedOptions(examTargetRows.map(row => row.university)),
        banner.university
    );
    const facultyOptions = includeCurrentOption(
        getFacultyOptionsFor(banner.university),
        banner.faculty
    );
    const subjectOptions = includeCurrentOption(
        getSubjectOptionsFor(banner.university, banner.faculty),
        banner.subject
    );
    const yearOptions = includeCurrentOption(
        getYearOptionsFor(banner.university, banner.faculty, banner.subject),
        banner.year
    );
    const selectedSlots = Array.isArray(banner.slots) ? banner.slots : [banner.slot || 'exam_pre_submit'];
    const canUseExamTargeting = canTargetByExamData(selectedSlots);

    const toggleSlot = (slotValue) => {
        setBanner(prev => {
            const currentSlots = Array.isArray(prev.slots) ? prev.slots : [prev.slot || 'exam_pre_submit'];
            const nextSlots = currentSlots.includes(slotValue)
                ? currentSlots.filter(value => value !== slotValue)
                : [...currentSlots, slotValue];
            const normalizedSlots = nextSlots.length > 0 ? nextSlots : [slotValue];
            const nextSlot = normalizedSlots[0];
            const nextBanner = {
                ...prev,
                slots: normalizedSlots,
                slot: nextSlot,
                page_target: getPageTargetForSlot(nextSlot),
            };

            if (!canTargetByExamData(normalizedSlots)) {
                return { ...nextBanner, university: '', faculty: '', subject: '', year: '' };
            }

            return nextBanner;
        });
    };

    const handleUniversityChange = (nextUniversity) => {
        const nextFacultyOptions = getFacultyOptionsFor(nextUniversity);
        setBanner(prev => {
            const nextFaculty = prev.faculty && nextFacultyOptions.includes(prev.faculty) ? prev.faculty : '';
            const nextSubjectOptions = getSubjectOptionsFor(nextUniversity, nextFaculty);
            const nextSubject = prev.subject && nextSubjectOptions.includes(prev.subject) ? prev.subject : '';
            const nextYearOptions = getYearOptionsFor(nextUniversity, nextFaculty, nextSubject);
            const nextYear = prev.year && nextYearOptions.includes(String(prev.year)) ? prev.year : '';
            return { ...prev, university: nextUniversity, faculty: nextFaculty, subject: nextSubject, year: nextYear };
        });
    };

    const handleFacultyChange = (nextFaculty) => {
        setBanner(prev => {
            const nextSubjectOptions = getSubjectOptionsFor(prev.university, nextFaculty);
            const nextSubject = prev.subject && nextSubjectOptions.includes(prev.subject) ? prev.subject : '';
            const nextYearOptions = getYearOptionsFor(prev.university, nextFaculty, nextSubject);
            const nextYear = prev.year && nextYearOptions.includes(String(prev.year)) ? prev.year : '';
            return { ...prev, faculty: nextFaculty, subject: nextSubject, year: nextYear };
        });
    };

    const handleSubjectChange = (nextSubject) => {
        setBanner(prev => {
            const nextYearOptions = getYearOptionsFor(prev.university, prev.faculty, nextSubject);
            const nextYear = prev.year && nextYearOptions.includes(String(prev.year)) ? prev.year : '';
            return { ...prev, subject: nextSubject, year: nextYear };
        });
    };

    if (loading) return <div className="p-8 text-center">読み込み中...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto flex flex-col lg:flex-row gap-8">
            {/* 左側：設定フォーム */}
            <div className="flex-1">
                <div className="flex items-center gap-4 mb-6">
                    <Link to="/admin/banners" className="text-gray-400 hover:text-gray-600">←</Link>
                    <div>
                        <h1 className="text-2xl font-bold text-navy-blue">{isNew ? '広告を作成・配信設定' : '広告を編集・配信設定'}</h1>
                        <p className="text-sm text-gray-500 mt-1">広告素材、表示場所、対象条件、公開状態をこの1画面でまとめて設定します。</p>
                    </div>
                </div>

                <form onSubmit={handleSave} className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 space-y-6">
                    <div className="text-xs font-bold text-navy-blue tracking-wide border-b border-gray-100 pb-2">1. 広告素材</div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">管理用のタイトル</label>
                        <input
                            type="text"
                            required
                            value={banner.title}
                            onChange={e => setBanner({ ...banner, title: e.target.value })}
                            className="w-full rounded-lg border-gray-300 shadow-sm p-3 border focus:ring-navy-blue focus:border-navy-blue"
                            placeholder="例: 夏季講習2025 受付中"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">広告の説明文</label>
                        <textarea
                            value={banner.description || ''}
                            onChange={e => setBanner({ ...banner, description: e.target.value })}
                            className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            rows={3}
                            placeholder="例: 慶應商学部の日本史対策講座を販売中。採点結果から弱点別に復習できます。"
                        />
                    </div>

                    <div className="text-xs font-bold text-navy-blue tracking-wide border-b border-gray-100 pb-2">2. 表示場所・配信条件</div>

                    <div>
                        <div className="block text-sm font-bold text-gray-700 mb-2">表示場所（複数選択可）</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {AD_SLOTS.map(slot => (
                                <label
                                    key={slot.value}
                                    className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${
                                        selectedSlots.includes(slot.value)
                                            ? 'border-navy-blue bg-navy-blue/5 text-navy-blue'
                                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedSlots.includes(slot.value)}
                                        onChange={() => toggleSlot(slot.value)}
                                        className="w-4 h-4 text-navy-blue rounded"
                                    />
                                    <span className="text-sm font-bold">{slot.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">表示対象</label>
                            <select
                                value={banner.target_audience || 'all'}
                                onChange={e => setBanner({ ...banner, target_audience: e.target.value })}
                                className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            >
                                {AD_AUDIENCES.map(audience => (
                                    <option key={audience.value} value={audience.value}>{audience.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                            <div className="text-xs font-bold text-gray-500">広告形式</div>
                            <div className="text-sm font-bold text-gray-800 mt-1">横長バナー</div>
                        </div>
                    </div>

                    {canUseExamTargeting && (
                        <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
                            <div className="text-sm font-bold text-amber-800 mb-3">大学・学部などの表示条件（空欄なら全対象）</div>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <select
                                    value={banner.university || ''}
                                    onChange={e => handleUniversityChange(e.target.value)}
                                    className="rounded-lg border-gray-300 shadow-sm p-3 border"
                                >
                                    <option value="">すべての大学</option>
                                    {universityOptions.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                                <select
                                    value={banner.faculty || ''}
                                    onChange={e => handleFacultyChange(e.target.value)}
                                    className="rounded-lg border-gray-300 shadow-sm p-3 border"
                                >
                                    <option value="">すべての学部</option>
                                    {facultyOptions.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                                <select
                                    value={banner.subject || ''}
                                    onChange={e => handleSubjectChange(e.target.value)}
                                    className="rounded-lg border-gray-300 shadow-sm p-3 border"
                                >
                                    <option value="">すべての科目</option>
                                    {subjectOptions.map(option => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                </select>
                                <select
                                    value={banner.year || ''}
                                    onChange={e => setBanner({ ...banner, year: e.target.value })}
                                    className="rounded-lg border-gray-300 shadow-sm p-3 border"
                                >
                                    <option value="">すべての年度</option>
                                    {yearOptions.map(option => (
                                        <option key={option} value={option}>{option}年</option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-xs text-amber-700 mt-2">
                                候補は作成済み試験データから自動取得します。採点前・結果系の表示場所を選択した時だけ条件を指定できます。
                                {targetOptionsLoading ? ' 候補を読み込み中です。' : ''}
                            </p>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">バナー画像 (自動でWebPに変換されます)</label>
                        <div className="flex items-center gap-4">
                            <input
                                type="text"
                                value={banner.image_url}
                                onChange={e => setBanner({ ...banner, image_url: e.target.value })}
                                className="flex-1 rounded-lg border-gray-300 shadow-sm p-3 border italic text-sm text-gray-400"
                                placeholder="https://..."
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 px-4 rounded-lg text-sm transition-colors whitespace-nowrap"
                            >
                                {uploading ? 'アップロード中...' : 'ファイル選択'}
                            </button>
                            <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleFileChange} />
                        </div>
                    </div>

                    <div className="text-xs font-bold text-navy-blue tracking-wide border-b border-gray-100 pb-2">3. 遷移先・公開設定</div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">遷移先URL</label>
                        <input
                            type="url"
                            required
                            value={banner.target_url}
                            onChange={e => setBanner({ ...banner, target_url: e.target.value })}
                            className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            placeholder="https://example.com/course"
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <label className="block text-sm font-bold text-gray-700">表示サイズ</label>
                            <span className="text-xs font-black text-navy-blue bg-navy-blue/5 px-2 py-1 rounded-md">
                                {clampBannerWidthPercent(banner.width_percent)}%
                            </span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                            {[
                                { label: '標準', value: 100 },
                                { label: '小さめ', value: 70 },
                                { label: 'かなり小さめ', value: 50 },
                                { label: '最小', value: 30 }
                            ].map(option => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setBanner({ ...banner, width_percent: option.value })}
                                    className={`py-2 px-2 rounded-lg border text-xs font-bold transition-all ${
                                        clampBannerWidthPercent(banner.width_percent) === option.value
                                            ? 'bg-navy-blue text-white border-navy-blue'
                                            : 'bg-white text-gray-600 border-gray-200 hover:border-navy-blue/40'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <input
                            type="range"
                            min="30"
                            max="100"
                            step="1"
                            value={clampBannerWidthPercent(banner.width_percent)}
                            onChange={e => setBanner({ ...banner, width_percent: clampBannerWidthPercent(e.target.value) })}
                            className="w-full accent-red-700"
                        />
                        <p className="text-[10px] text-gray-500 mt-2">
                            プレビュー右下の角をドラッグしても調整できます。
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">公開終了日 (空欄で無期限)</label>
                        <input
                            type="date"
                            value={banner.end_at}
                            onChange={e => setBanner({ ...banner, end_at: e.target.value })}
                            className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                        />
                    </div>

                    <div className="flex items-center gap-4 pt-4 border-t">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={banner.is_active}
                                onChange={e => setBanner({ ...banner, is_active: e.target.checked })}
                                className="w-5 h-5 text-navy-blue rounded"
                            />
                            <span className="font-bold text-gray-700">今すぐ公開する</span>
                        </label>
                    </div>

                    <div className="flex gap-4">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 bg-navy-blue text-white font-bold py-4 rounded-xl shadow-lg hover:bg-opacity-90 transition-all disabled:bg-gray-400"
                        >
                            {saving ? '保存中...' : '広告管理に保存する'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/admin/banners')}
                            className="bg-gray-100 text-gray-600 font-bold py-4 px-8 rounded-xl hover:bg-gray-200 transition-all"
                        >
                            キャンセル
                        </button>
                    </div>
                </form>
            </div>

            {/* 右側：リアルタイムプレビュー */}
            <div className="lg:w-96 flex flex-col pt-10">
                <div className="sticky top-10 space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-bold text-gray-700">表示プレビュー</h2>
                        <div className="flex bg-gray-100 p-1 rounded-lg">
                            <button
                                onClick={() => setPreviewMode('desktop')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${previewMode === 'desktop' ? 'bg-white shadow text-navy-blue' : 'text-gray-500'}`}
                            >
                                PC
                            </button>
                            <button
                                onClick={() => setPreviewMode('mobile')}
                                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${previewMode === 'mobile' ? 'bg-white shadow text-navy-blue' : 'text-gray-500'}`}
                            >
                                スマホ
                            </button>
                        </div>
                    </div>

                    <div className={`bg-gray-200 rounded-md p-4 overflow-hidden border-4 border-gray-300 transition-all duration-300 flex items-center justify-center ${previewMode === 'mobile' ? 'w-[320px] h-[500px] mx-auto' : 'w-full h-[400px]'}`}>
                        <div className="w-full h-full bg-white rounded shadow-inner p-4 overflow-y-auto relative">
                            {/* モックコンテンツ */}
                            <div className="w-full h-8 bg-gray-100 mb-4 rounded"></div>
                            <div className="w-3/4 h-3 bg-gray-100 mb-2 rounded"></div>
                            <div className="w-1/2 h-3 bg-gray-100 mb-6 rounded"></div>

                            {/* 実際のバナープレビュー */}
                            <div className="ad-container">
                                <div className="flex justify-center w-full">
                                    <div
                                        data-banner-preview-resize-box
                                        className="relative min-w-[140px] max-w-full"
                                        style={{ width: `${clampBannerWidthPercent(banner.width_percent)}%` }}
                                    >
                                        <div className="relative group cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-navy-blue/30 transition-shadow aspect-[12/3]">
                                            {banner.image_url ? (
                                                <img src={banner.image_url} alt="preview" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400">
                                                    <span className="text-xl">画像なし</span>
                                                    <span className="text-[10px] mt-1">横長バナー</span>
                                                </div>
                                            )}
                                            <div className="absolute bottom-2 right-2 bg-red-700 text-white text-[9px] font-black px-2 py-1 rounded-sm">詳しく見る</div>
                                            <div className="absolute top-2 right-2 bg-black/75 text-white text-[8px] px-1.5 py-0.5 rounded-sm">広告</div>
                                        </div>
                                        <button
                                            type="button"
                                            aria-label="広告サイズを調整"
                                            title="ドラッグして広告サイズを調整"
                                            onPointerDown={handlePreviewResizeStart}
                                            className="absolute -right-2 -bottom-2 w-[18px] h-[18px] rounded border-2 border-navy-blue bg-white shadow-md cursor-nwse-resize z-20"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="w-full h-20 bg-gray-50 mt-8 rounded flex items-center justify-center text-[10px] text-gray-300 italic">Example Content</div>
                        </div>
                    </div>

                    <div className="bg-accent-gold/10 p-4 rounded-xl border border-accent-gold/20">
                        <p className="text-xs text-accent-gold font-bold mb-1">💡 プレビューの注意点</p>
                        <p className="text-[10px] text-gray-600 leading-relaxed">
                            このプレビューは表示イメージです。横長の画像を用意してください。
                        </p>
                    </div>
                </div>
            </div>

            <style>{`
                .animate-pulse-slow {
                    animation: pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.95; transform: scale(0.99); }
                }
            `}</style>
        </div>
    );
};

export default AdminBannerEditor;
