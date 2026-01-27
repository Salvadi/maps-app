import React, { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CertificateUpload } from './CertificateUpload';
import { CertificateList } from './CertificateList';
import { Certificate } from '../../db/database';
import './FireSealStyles.css';

interface FireSealAdminPageProps {
  userId: string;
  onBack: () => void;
}

export function FireSealAdminPage({ userId, onBack }: FireSealAdminPageProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleUploadComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const handleViewPDF = useCallback((certificate: Certificate) => {
    // TODO: Implement PDF viewer
    if (certificate.fileUrl) {
      window.open(certificate.fileUrl, '_blank');
    } else if (certificate.fileBlob) {
      const url = URL.createObjectURL(certificate.fileBlob);
      window.open(url, '_blank');
    }
  }, []);

  return (
    <div className="fireseal-admin-page">
      {/* Header */}
      <header className="fireseal-header">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={24} />
        </button>
        <h1>Gestione Certificati</h1>
      </header>

      {/* Content */}
      <div className="admin-content">
        {/* Upload Section */}
        <section className="admin-section">
          <h2>Carica Nuovo Certificato</h2>
          <CertificateUpload
            userId={userId}
            onUploadComplete={handleUploadComplete}
          />
        </section>

        {/* List Section */}
        <section className="admin-section">
          <h2>Certificati Caricati</h2>
          <CertificateList
            refreshTrigger={refreshTrigger}
            onViewPDF={handleViewPDF}
          />
        </section>
      </div>
    </div>
  );
}
