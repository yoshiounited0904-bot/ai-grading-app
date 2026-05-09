import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';


const UniversityCard = ({ university }) => {
    const navigate = useNavigate();
    const { user } = useAuth();

    const handleClick = () => {
        if (!user) {
            document.dispatchEvent(new CustomEvent('openAuthModal', { 
                detail: { message: '試験を解くにはログインが必要です' } 
            }));
            return;
        }
        navigate(`/university/${university.id}`);
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.25rem', color: 'var(--color-text-primary)' }}>{university.name}</h3>
                <span style={{
                    fontSize: '0.8rem',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '20px',
                    background: 'var(--color-bg-secondary)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    {university.type}
                </span>
            </div>

            <div style={{ marginTop: 'auto' }}>
                <button
                    className="btn btn-primary btn-mobile-full"
                    style={{ width: '100%' }}
                    onClick={handleClick}
                >
                    学部・学科を選択
                </button>
            </div>

        </div>
    );
};

export default UniversityCard;
