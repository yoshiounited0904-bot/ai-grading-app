import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAdminEmail } from '../config/adminConfig';

function AdminRoute() {
    const { user, profile, loading } = useAuth();
    const hasAdminEmail = isAdminEmail(user?.email);

    if (loading || (user && !profile && !hasAdminEmail)) {
        return (
            <div className="flex justify-center items-center min-h-[calc(100vh-64px)]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
            </div>
        );
    }

    // UI gate only. Actual data access is protected by Supabase RLS.
    // Allow the configured admin emails to enter even if profile loading is slow.
    const isVerified = user?.user_metadata?.email_verified !== false;
    const isAdmin = profile?.role === 'admin' || hasAdminEmail;

    if (!user || !isVerified || !isAdmin) {
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
}

export default AdminRoute;
