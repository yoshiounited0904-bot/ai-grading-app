import React from 'react';

const UniversitySkeleton = () => {
    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', height: '140px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="skeleton" style={{ height: '1.5rem', width: '60%', borderRadius: '4px' }}></div>
                <div className="skeleton" style={{ height: '1.2rem', width: '20%', borderRadius: '20px' }}></div>
            </div>
            
            <div style={{ marginTop: 'auto' }}>
                <div className="skeleton" style={{ height: '2.5rem', width: '100%', borderRadius: '8px' }}></div>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                .skeleton {
                    background: linear-gradient(90deg, #f0f0f0 25%, #f8f8f8 50%, #f0f0f0 75%);
                    background-size: 200% 100%;
                    animation: shimmer 1.5s infinite linear;
                }
                @keyframes shimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
            `}} />
        </div>
    );
};

export default UniversitySkeleton;
