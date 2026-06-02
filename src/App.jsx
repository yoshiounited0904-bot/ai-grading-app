import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ExamPage from './pages/ExamPage';
import ResultPage from './pages/ResultPage';
import DashboardPage from './pages/DashboardPage';
import UniversityPage from './pages/UniversityPage';
import FacultyPage from './pages/FacultyPage';
import WeaknessPage from './pages/WeaknessPage';
import AuthModal from './components/AuthModal';
import Navbar from './components/Navbar';
import AdminRoute from './components/AdminRoute';
import AdminDashboard from './pages/AdminDashboard';
import AdminExamEditor from './pages/AdminExamEditor';
import AdminExamLab from './pages/AdminExamLab';
import AdminBannerDashboard from './pages/AdminBannerDashboard';
import AdminBannerEditor from './pages/AdminBannerEditor';
import AdminUserDashboard from './pages/AdminUserDashboard';
import AnswerVerifyPage from './pages/AnswerVerifyPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import Footer from './components/Footer';
import { useAuth } from './contexts/AuthContext';
import { isAdminEmail } from './config/adminConfig';
import PendingApprovalPage from './pages/PendingApprovalPage';

function App() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    const handleOpenAuthModal = () => setShowAuthModal(true);
    document.addEventListener('openAuthModal', handleOpenAuthModal);
    return () => document.removeEventListener('openAuthModal', handleOpenAuthModal);
  }, []);

  const isPending = user && profile?.approval_status === 'pending' && !isAdminEmail(user.email);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-navy-blue"></div>
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        {isPending ? (
          <div className="flex-1">
            <Routes>
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="*" element={<PendingApprovalPage />} />
            </Routes>
          </div>
        ) : (
          <>
            <div className="flex-1">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/pending" element={<PendingApprovalPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/university/:universityId" element={<UniversityPage />} />
                <Route path="/university/:universityId/faculty/:facultyId" element={<FacultyPage />} />
                <Route path="/exam/:id" element={<ExamPage />} />
                <Route path="/result" element={<ResultPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/weakness" element={<WeaknessPage />} />

                <Route element={<AdminRoute />}>
                  <Route path="/admin" element={<AdminDashboard />} />
                  <Route path="/admin/exam-lab" element={<AdminExamLab />} />
                  <Route path="/admin/users" element={<AdminUserDashboard />} />
                  <Route path="/admin/exam/:id" element={<AdminExamEditor />} />
                  <Route path="/admin/exam/:id/verify" element={<AnswerVerifyPage />} />
                  <Route path="/admin/banners" element={<AdminBannerDashboard />} />
                  <Route path="/admin/banners/new" element={<AdminBannerEditor />} />
                  <Route path="/admin/banners/:id" element={<AdminBannerEditor />} />
                </Route>
              </Routes>
            </div>
            <Footer />
          </>
        )}
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    </Router>
  );
}

export default App;
