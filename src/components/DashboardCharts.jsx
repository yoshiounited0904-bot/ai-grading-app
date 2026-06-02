import React, { useMemo } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell,
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';

const DashboardCharts = ({ results }) => {
    // --- Data Processing ---

    // 1. Score Trend Data (Reverse chronological order for chart)
    const trendData = useMemo(() => {
        return [...results].reverse().map((r, index) => ({
            name: `回${index + 1}`, // Or date
            date: new Date(r.created_at).toLocaleDateString(),
            score: Math.round((r.score / r.max_score) * 100),
            subject: r.exam_subject,
            university: r.university_name
        }));
    }, [results]);

    // 2. Pass Probability Distribution
    const pieData = useMemo(() => {
        const counts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        results.forEach(r => {
            if (counts[r.pass_probability] !== undefined) {
                counts[r.pass_probability]++;
            }
        });
        return Object.keys(counts).map(key => ({
            name: `${key}判定`,
            value: counts[key]
        })).filter(d => d.value > 0);
    }, [results]);

    const COLORS = {
        'A判定': '#10b981', // Green
        'B判定': '#3b82f6', // Blue
        'C判定': '#f59e0b', // Yellow/Orange
        'D判定': '#f97316', // Orange
        'E判定': '#ef4444'  // Red
    };

    // 3. Subject Radar Data
    const radarData = useMemo(() => {
        const subjectStats = {};
        results.forEach(r => {
            if (!subjectStats[r.exam_subject]) {
                subjectStats[r.exam_subject] = { total: 0, count: 0 };
            }
            subjectStats[r.exam_subject].total += (r.score / r.max_score) * 100;
            subjectStats[r.exam_subject].count++;
        });

        return Object.keys(subjectStats).map(subject => ({
            subject: subject,
            A: Math.round(subjectStats[subject].total / subjectStats[subject].count),
            fullMark: 100
        }));
    }, [results]);

    if (results.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem', marginBottom: '4rem' }}>

            {/* Row 1: Score Trend */}
            <div className="glass-panel" style={{ padding: '2rem' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#1e293b' }}>得点率の推移</h3>
                <div style={{ height: '300px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickFormatter={(val) => val.slice(5)} />
                            <YAxis stroke="#64748b" fontSize={12} domain={[0, 100]} />
                            <Tooltip
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                                formatter={(value, name, props) => [`${value}%`, `${props.payload.university} ${props.payload.subject}`]}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="score" name="得点率" stroke="var(--color-accent-primary)" strokeWidth={3} activeDot={{ r: 8 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Row 2: Pie & Radar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>

                {/* Pass Probability Pie Chart */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#1e293b' }}>合格判定の割合</h3>
                    <div style={{ height: '300px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#888'} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Subject Radar Chart */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '1.5rem', color: '#1e293b' }}>科目別平均得点率</h3>
                    <div style={{ height: '300px', width: '100%' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                <Radar
                                    name="平均点"
                                    dataKey="A"
                                    stroke="#8b5cf6"
                                    fill="#8b5cf6"
                                    fillOpacity={0.5}
                                />
                                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} formatter={(val) => `${val}%`} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DashboardCharts;
