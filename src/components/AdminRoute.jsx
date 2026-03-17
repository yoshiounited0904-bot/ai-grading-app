import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { isAdminEmail } from '../config/adminConfig';
import { supabase } from '../services/supabaseClient';

function AdminRoute() {
    const { user, profile, loading } = useAuth();

    const isEmailAllowed = isAdminEmail(user?.email);

    // If the user's email is an explicitly allowed admin email, but their database role
    // isn't 'admin' yet, automatically promote them so they pass RLS restrictions.
    useEffect(() => {
        const promoteIfNecessary = async () => {
            if (user && isEmailAllowed && profile && profile.role !== 'admin') {
                try {
                    console.log("[AdminRoute] Auto-promoting authorized email to admin in database...");
                    const { error } = await supabase
                        .from('profiles')
                        .update({ role: 'admin' })
                        .eq('id', user.id);
                    if (error) throw error;
                    console.log("[AdminRoute] Auto-promotion successful.");
                } catch (err) {
                    console.error("[AdminRoute] Failed to auto-promote to admin:", err);
                }
            }
        };
        promoteIfNecessary();
    }, [user, profile, isEmailAllowed]);

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[calc(100vh-64px)]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
            </div>
        );
    }

    // プロフィールのroleがadminであるか、またはメールアドレスが許可されている場合アクセス可
    if (!user || (!isEmailAllowed && profile?.role !== 'admin')) {
        // Not logged in or not an admin, redirect to home
        return <Navigate to="/" replace />;
    }

    return <Outlet />;
}

export default AdminRoute;
