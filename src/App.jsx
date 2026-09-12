import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ExamPage from './pages/ExamPage';
import ResultPage from './pages/ResultPage';
import DashboardPage from './pages/DashboardPage';
import UniversityPage from './pages/UniversityPage';
import FacultyPage from './pages/FacultyPage';
import AuthModal from './components/AuthModal';
import Navbar from './components/Navbar';
import AdminRoute from './components/AdminRoute';
import AdminDashboard from './pages/AdminDashboard';
import AdminExamEditor from './pages/AdminExamEditor';
import AdminExamLab from './pages/AdminExamLab';
import AdminBannerDashboard from './pages/AdminBannerDashboard';
import AdminBannerEditor from './pages/AdminBannerEditor';
import AdminUserDashboard from './pages/AdminUserDashboard';
import AdminConsultationsPage from './pages/AdminConsultationsPage';
import AnswerVerifyPage from './pages/AnswerVerifyPage';
import AnswerImageSnippetGenerator from './pages/AnswerImageSnippetGenerator';
import UniversityDataChecklistPage from './pages/UniversityDataChecklistPage';
import UniversityDataCoveragePage from './pages/UniversityDataCoveragePage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import Footer from './components/Footer';
import { useAuth } from './contexts/AuthContext';
import ConsultationPage from './pages/ConsultationPage';
import PremiumPage from './pages/PremiumPage';
import { MARKETING_CONFIG } from './config/marketingConfig';

function App() {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    const handleOpenAuthModal = () => setShowAuthModal(true);
    document.addEventListener('openAuthModal', handleOpenAuthModal);
    return () => document.removeEventListener('openAuthModal', handleOpenAuthModal);
  }, []);

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
        <>
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/pending" element={<Navigate to="/" replace />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/premium" element={<PremiumPage />} />
              <Route
                path="/consultation"
                element={MARKETING_CONFIG.enableConsultation ? <ConsultationPage /> : <Navigate to="/premium" replace />}
              />
              <Route path="/university/:universityId" element={<UniversityPage />} />
              <Route path="/university/:universityId/faculty/:facultyId" element={<FacultyPage />} />
              <Route path="/exam/:id" element={<ExamPage />} />
              <Route path="/result" element={<ResultPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/weakness" element={<Navigate to="/dashboard" replace />} />

              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/exam-lab" element={<AdminExamLab />} />
                <Route path="/admin/users" element={<AdminUserDashboard />} />
                <Route
                  path="/admin/consultations"
                  element={MARKETING_CONFIG.enableConsultation ? <AdminConsultationsPage /> : <Navigate to="/admin" replace />}
                />
                <Route path="/admin/answer-image-snippet" element={<AnswerImageSnippetGenerator />} />
                <Route path="/admin/university-data-checklist" element={<UniversityDataChecklistPage />} />
                <Route path="/admin/university-data-coverage" element={<UniversityDataCoveragePage />} />
                <Route path="/admin/exam/new" element={<AdminExamEditor />} />
                <Route path="/admin/exam/:id" element={<AdminExamEditor />} />
                <Route path="/admin/exam/:id/verify" element={<AnswerVerifyPage />} />
                <Route
                  path="/admin/banners"
                  element={MARKETING_CONFIG.enableAdBanners ? <AdminBannerDashboard /> : <Navigate to="/admin" replace />}
                />
                <Route
                  path="/admin/banners/new"
                  element={MARKETING_CONFIG.enableAdBanners ? <AdminBannerEditor /> : <Navigate to="/admin" replace />}
                />
                <Route
                  path="/admin/banners/:id"
                  element={MARKETING_CONFIG.enableAdBanners ? <AdminBannerEditor /> : <Navigate to="/admin" replace />}
                />
              </Route>
            </Routes>
          </div>
          <Footer />
        </>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </div>
    </Router>
  );
}

export default App;
