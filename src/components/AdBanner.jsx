import React, { useState, useEffect } from 'react';
import { clampBannerWidthPercent, getActiveBanners, incrementClick, getBannerById } from '../services/adminBannerService';
import { MARKETING_CONFIG } from '../config/marketingConfig';

const AdBanner = ({
    pageTarget = 'all',
    slot = null,
    bannerId = null,
    className = '',
    context = {},
    audience = null,
    widthPercentOverride = null
}) => {
    const [banners, setBanners] = useState([]);
    const [loading, setLoading] = useState(true);
    const resolvedSlot = slot || pageTarget || 'all';

    useEffect(() => {
        if (!MARKETING_CONFIG.enableAdBanners) {
            setLoading(false);
            return;
        }

        const fetchBanners = async () => {
            try {
                if (bannerId) {
                    const data = await getBannerById(bannerId);
                    setBanners([data]);
                } else {
                    let data = await getActiveBanners(resolvedSlot, {
                        pageTarget,
                        context,
                        audience,
                        limit: 1
                    });
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
    }, [pageTarget, resolvedSlot, bannerId, audience, JSON.stringify(context)]);

    const handleClick = async (id) => {
        try {
            await incrementClick(id);
        } catch (err) {
            console.error("Click tracking failed:", err);
        }
    };

    if (!MARKETING_CONFIG.enableAdBanners || loading || banners.length === 0) return null;

    const banner = banners[0];
    const widthPercent = clampBannerWidthPercent(widthPercentOverride || banner.width_percent || 100);

    const renderBanner = () => {
        return (
            <a
                href={banner.target_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick(banner.id)}
                className="block relative group overflow-hidden rounded-sm shadow-sm border border-gray-200 hover:shadow-md transition-all w-full min-h-[60px] aspect-[16/3] md:aspect-[1200/300]"
            >
                <img
                    src={banner.image_url}
                    alt={banner.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    style={{ minHeight: '60px' }}
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <span className="text-white text-xs font-bold drop-shadow-md">{banner.title}</span>
                </div>
                <div className="absolute top-2 right-2 bg-black/75 text-white text-[8px] px-1.5 py-0.5 rounded-sm">広告</div>
            </a>
        );
    };

    return (
        <div className={`ad-banner-widget py-2 md:py-4 ${className}`}>
            <div
                className="mx-auto"
                style={{
                    width: `${widthPercent}%`,
                    minWidth: '160px',
                    maxWidth: '100%'
                }}
            >
                {renderBanner()}
            </div>
        </div>
    );
};

export default AdBanner;
