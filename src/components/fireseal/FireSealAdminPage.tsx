import React, { useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CertificateUpload } from './CertificateUpload';
import { CertificateList } from './CertificateList';
import { Certificate } from '../../db/database';
import { getCertificatePDFUrl } from '../../sync/certificateSyncEngine';
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

  const handleViewPDF = useCallback(async (certificate: Certificate) => {
    try {
      // Prefer local blob first
      if (certificate.fileBlob) {
        const url = URL.createObjectURL(certificate.fileBlob);
        window.open(url, '_blank');
        return;
      }

      // Get signed URL for remote PDF
      if (certificate.fileName) {
        const signedUrl = await getCertificatePDFUrl(
          certificate.id,
          certificate.fileName
        );
        window.open(signedUrl, '_blank');
        return;
      }

      console.error('No PDF source available for certificate');
      alert('Impossibile aprire il PDF. File non disponibile.');
    } catch (err) {
      console.error('Error opening PDF:', err);
      alert('Impossibile aprire il PDF. Verifica la configurazione dello storage.');
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
