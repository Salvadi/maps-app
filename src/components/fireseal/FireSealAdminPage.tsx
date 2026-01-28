import React, { useState, useCallback } from 'react';
import NavigationBar from '../NavigationBar';
import { CertificateUpload } from './CertificateUpload';
import { CertificateList } from './CertificateList';
import { Certificate } from '../../db/database';
import { getCertificatePDFUrl, syncCertificates } from '../../sync/certificateSyncEngine';
import './FireSealStyles.css';

interface FireSealAdminPageProps {
  userId: string;
  onBack: () => void;
}

export function FireSealAdminPage({ userId, onBack }: FireSealAdminPageProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleUploadComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await syncCertificates();
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  const handleViewPDF = useCallback(async (certificate: Certificate) => {
    try {
      // Prefer local blob first
      if (certificate.fileBlob) {
        const url = URL.createObjectURL(certificate.fileBlob);
        window.open(url, '_blank');
        // Revoke URL after delay to prevent memory leak
        // (give browser time to start loading the PDF)
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      <NavigationBar
        title="Gestione Certificati"
        onBack={onBack}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

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
