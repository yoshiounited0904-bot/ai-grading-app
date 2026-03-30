import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { createBanner, updateBanner, getAdminBanners, uploadBannerImage } from '../services/adminBannerService';

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
        page_target: 'all'
    });

    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [previewMode, setPreviewMode] = useState('desktop'); // 'desktop' or 'mobile'

    const fileInputRef = useRef(null);

    useEffect(() => {
        if (id) {
            loadBanner();
        }
    }, [id]);

    const loadBanner = async () => {
        try {
            const data = await getAdminBanners();
            const found = data.find(b => b.id === id);
            if (found) {
                setBanner({
                    ...found,
                    start_at: found.start_at ? found.start_at.split('T')[0] : '',
                    end_at: found.end_at ? found.end_at.split('T')[0] : ''
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

            if (isNew) {
                await createBanner(dataToSave);
            } else {
                await updateBanner(id, dataToSave);
            }
            navigate('/admin/banners');
        } catch (err) {
            alert("保存に失敗しました。URLの形式などを確認してください。");
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

    if (loading) return <div className="p-8 text-center">読み込み中...</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto flex flex-col lg:flex-row gap-8">
            {/* 左側：設定フォーム */}
            <div className="flex-1">
                <div className="flex items-center gap-4 mb-6">
                    <Link to="/admin/banners" className="text-gray-400 hover:text-gray-600">←</Link>
                    <h1 className="text-2xl font-bold text-navy-blue">{isNew ? '新規広告作成' : '広告の編集'}</h1>
                </div>

                <form onSubmit={handleSave} className="bg-white rounded-xl shadow-lg p-6 border border-gray-100 space-y-6">
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">掲載レイアウト</label>
                            <select
                                value={banner.layout_type}
                                onChange={e => setBanner({ ...banner, layout_type: e.target.value })}
                                className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            >
                                <option value="horizontal">横長バナー (推奨: 1200x300)</option>
                                <option value="square">正方形 (推奨: 600x600)</option>
                                <option value="text">テキストのみ</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">掲載場所 (ターゲットID)</label>
                            <select
                                value={banner.page_target}
                                onChange={e => setBanner({ ...banner, page_target: e.target.value })}
                                className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            >
                                <option value="all">全ページ</option>
                                <option value="home">トップページ</option>
                                <option value="exam">採点入力画面</option>
                                <option value="result">採点結果画面</option>
                            </select>
                        </div>
                    </div>

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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">掲載開始日</label>
                            <input
                                type="date"
                                value={banner.start_at}
                                onChange={e => setBanner({ ...banner, start_at: e.target.value })}
                                className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-1">掲載終了日 (空欄で無期限)</label>
                            <input
                                type="date"
                                value={banner.end_at}
                                onChange={e => setBanner({ ...banner, end_at: e.target.value })}
                                className="w-full rounded-lg border-gray-300 shadow-sm p-3 border"
                            />
                        </div>
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
                            {saving ? '保存中...' : (isNew ? '広告を作成する' : '変更を保存する')}
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
                        <h2 className="text-lg font-bold text-gray-700">掲載プレビュー</h2>
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

                    <div className={`bg-gray-200 rounded-2xl p-4 overflow-hidden border-4 border-gray-300 transition-all duration-300 flex items-center justify-center ${previewMode === 'mobile' ? 'w-[320px] h-[500px] mx-auto' : 'w-full h-[400px]'}`}>
                        <div className="w-full h-full bg-white rounded shadow-inner p-4 overflow-y-auto relative">
                            {/* モックコンテンツ */}
                            <div className="w-full h-8 bg-gray-100 mb-4 rounded"></div>
                            <div className="w-3/4 h-3 bg-gray-100 mb-2 rounded"></div>
                            <div className="w-1/2 h-3 bg-gray-100 mb-6 rounded"></div>

                            {/* 実際のバナープレビュー */}
                            <div className="ad-container animate-pulse-slow">
                                {banner.layout_type === 'text' ? (
                                    <div className="bg-navy-blue/5 border-2 border-dashed border-navy-blue/30 p-3 rounded-lg text-center cursor-pointer hover:bg-navy-blue/10 transition-colors">
                                        <p className="text-navy-blue font-bold text-sm">【重要】{banner.title || 'タイトル未入力'}</p>
                                        <p className="text-[10px] text-gray-500 mt-1">詳細を見る →</p>
                                    </div>
                                ) : (
                                    <div className={`relative group cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-navy-blue/30 transition-all ${banner.layout_type === 'square' ? 'aspect-square' : 'aspect-[12/3]'}`}>
                                        {banner.image_url ? (
                                            <img src={banner.image_url} alt="preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400">
                                                <span className="text-2xl">🖼️</span>
                                                <span className="text-[10px] mt-1">画像なし</span>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors"></div>
                                    </div>
                                )}
                            </div>

                            <div className="w-full h-20 bg-gray-50 mt-8 rounded flex items-center justify-center text-[10px] text-gray-300 italic">Example Content</div>
                        </div>
                    </div>

                    <div className="bg-accent-gold/10 p-4 rounded-xl border border-accent-gold/20">
                        <p className="text-xs text-accent-gold font-bold mb-1">💡 プレビューの注意点</p>
                        <p className="text-[10px] text-gray-600 leading-relaxed">
                            このプレビューは配置イメージです。実際のサイトでは周囲のカラーやフォントに合わせて自動調整されます。レイアウトタイプに合わせて最適な画像を用意してください。
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
