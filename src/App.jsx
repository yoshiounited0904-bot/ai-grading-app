import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
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
import AdminBannerDashboard from './pages/AdminBannerDashboard';
import AdminBannerEditor from './pages/AdminBannerEditor';

function App() {
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const handleOpenAuthModal = () => setShowAuthModal(true);
    document.addEventListener('openAuthModal', handleOpenAuthModal);
    return () => document.removeEventListener('openAuthModal', handleOpenAuthModal);
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/university/:universityId" element={<UniversityPage />} />
          <Route path="/university/:universityId/faculty/:facultyId" element={<FacultyPage />} />
          <Route path="/exam/:id" element={<ExamPage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/weakness" element={<WeaknessPage />} />

          {/* Admin Routes */}
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/exam/:id" element={<AdminExamEditor />} />
            <Route path="/admin/banners" element={<AdminBannerDashboard />} />
            <Route path="/admin/banners/new" element={<AdminBannerEditor />} />
            <Route path="/admin/banners/:id" element={<AdminBannerEditor />} />
          </Route>
        </Routes>
        <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      </Router>
    </AuthProvider>
  );
}

export default App;
