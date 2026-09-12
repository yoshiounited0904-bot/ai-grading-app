import React from 'react';
import { MARKETING_CONFIG } from '../config/marketingConfig';

const ConsultationCTA = ({
    title = 'この答案をプロ講師に見てもらう',
    description = '採点結果・答案・弱点分析をもとに、次にやるべき復習を整理します。',
    buttonLabel = '答案相談を申し込む',
    note = '申込後、LINEに送れる照合文面を自動で作成します。',
    points = ['答案を確認', '弱点を整理', '復習方針を提案'],
    variant = 'default',
    onClick
}) => {
    if (!MARKETING_CONFIG.enableConsultation) return null;

    return (
        <div className={`consultation-cta consultation-cta--${variant} no-print`}>
            <div className="consultation-cta__body">
                <div className="consultation-cta__copy">
                    <h2>{title}</h2>
                    {description && <p>{description}</p>}
                    {points?.length > 0 && (
                        <div className="consultation-cta__points" aria-label="カウンセリング内容">
                            {points.map(point => <span key={point}>{point}</span>)}
                        </div>
                    )}
                </div>
                <div className="consultation-cta__action">
                    <button type="button" onClick={onClick} className="consultation-cta__button">
                        {buttonLabel}
                    </button>
                    {note && <p>{note}</p>}
                </div>
            </div>
        </div>
    );
};

export default ConsultationCTA;
