import React, { useState, useEffect } from 'react';
import { getActiveBanners, incrementClick, getBannerById } from '../services/adminBannerService';

const AdBanner = ({ pageTarget = 'all', bannerId = null, className = '' }) => {
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBanners = async () => {
            try {
                if (bannerId) {
                    const data = await getBannerById(bannerId);
                    setBanners([data]);
                } else {
                    let data = await getActiveBanners(pageTarget);
                    // Fallback: If no banners for specific target, try 'all'
                    if ((!data || data.length === 0) && pageTarget !== 'all') {
                        console.log(`No banners for target "${pageTarget}", falling back to "all"`);
                        data = await getActiveBanners('all');
                    }
                    setBanners(data || []);
                }
            } catch (err) {
                console.error("AdBanner error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchBanners();
    }, [pageTarget, bannerId]);

    const handleClick = async (id) => {
        try {
            await incrementClick(id);
        } catch (err) {
            console.error("Click tracking failed:", err);
        }
    };

    if (loading || banners.length === 0) return null;

    // For simplicity, we show the most recent banner that matches
    const banner = banners[0];

    const renderBanner = () => {
        if (banner.layout_type === 'text') {
            return (
                <a
                    href={banner.target_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleClick(banner.id)}
                    className="block bg-navy-blue/5 border border-navy-blue/20 p-4 rounded-xl text-center hover:bg-navy-blue/10 transition-colors"
                >
                    <p className="text-navy-blue font-bold text-sm md:text-base">
                        <span className="bg-navy-blue text-white text-[10px] px-2 py-0.5 rounded-full mr-2 align-middle">PR</span>
                        {banner.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">詳細はこちらをクリック →</p>
                </a>
            );
        }

        const isSquare = banner.layout_type === 'square';

        return (
            <a
                href={banner.target_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick(banner.id)}
                className={`block relative group overflow-hidden rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all ${isSquare ? 'max-w-xs mx-auto aspect-square' : 'w-full min-h-[60px] aspect-[16/3] md:aspect-[1200/300]'}`}
            >
                <img
                    src={banner.image_url}
                    alt={banner.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    style={{ minHeight: '60px' }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <span className="text-white text-xs font-bold drop-shadow-md">詳細を見る →</span>
                </div>
                <div className="absolute top-2 right-2 bg-black/50 text-white text-[8px] px-1.5 py-0.5 rounded backdrop-blur-sm">広告</div>
            </a>
        );
    };

    return (
        <div className={`ad-banner-widget py-2 md:py-4 ${className}`}>
            {renderBanner()}
        </div>
    );
};

export default AdBanner;
