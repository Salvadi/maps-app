import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Trash2, Eye, RefreshCw, AlertCircle, Check, Clock, Loader2 } from 'lucide-react';
import {
  getAllCertificates,
  deleteCertificate,
  getChunkCount,
  getCertificateStats
} from '../../db/certificates';
import { Certificate } from '../../db/database';
import { deleteCertificateEverywhere, syncCertificates } from '../../sync/certificateSyncEngine';

interface CertificateListProps {
  onViewPDF?: (certificate: Certificate) => void;
  refreshTrigger?: number;
}

interface CertificateWithStats extends Certificate {
  chunkCount: number;
}

export function CertificateList({ onViewPDF, refreshTrigger }: CertificateListProps) {
  const [certificates, setCertificates] = useState<CertificateWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState<{
    totalCertificates: number;
    completedCertificates: number;
    totalChunks: number;
    chunksWithEmbeddings: number;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadCertificates = useCallback(async () => {
    setLoading(true);
    try {
      const certs = await getAllCertificates();

      // Get chunk count for each certificate
      const certsWithStats = await Promise.all(
        certs.map(async (cert) => ({
          ...cert,
          chunkCount: await getChunkCount(cert.id)
        }))
      );

      setCertificates(certsWithStats);

      // Load stats
      const certStats = await getCertificateStats();
      setStats(certStats);
    } catch (error) {
      console.error('Error loading certificates:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCertificates();
  }, [loadCertificates, refreshTrigger]);

  const handleDelete = async (cert: Certificate) => {
    if (deleteConfirm !== cert.id) {
      setDeleteConfirm(cert.id);
      return;
    }

    try {
      await deleteCertificateEverywhere(cert.id);
      setDeleteConfirm(null);
      loadCertificates();
    } catch (error) {
      console.error('Error deleting certificate:', error);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCertificates();
      console.log('Sync result:', result);
      loadCertificates();
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setSyncing(false);
    }
  };

  const getStatusIcon = (status: Certificate['processingStatus']) => {
    switch (status) {
      case 'completed':
        return <Check size={16} className="status-icon completed" />;
      case 'processing':
        return <Loader2 size={16} className="status-icon processing spinner" />;
      case 'pending':
        return <Clock size={16} className="status-icon pending" />;
      case 'error':
        return <AlertCircle size={16} className="status-icon error" />;
    }
  };

  const getStatusText = (status: Certificate['processingStatus']) => {
    switch (status) {
      case 'completed': return 'Completato';
      case 'processing': return 'In elaborazione...';
      case 'pending': return 'In attesa';
      case 'error': return 'Errore';
    }
  };

  if (loading) {
    return (
      <div className="certificate-list loading">
        <Loader2 size={24} className="spinner" />
        <p>Caricamento certificati...</p>
      </div>
    );
  }

  return (
    <div className="certificate-list">
      {/* Header with stats */}
      <div className="list-header">
        <div className="list-stats">
          <span className="stat">
            <strong>{stats?.totalCertificates || 0}</strong> certificati
          </span>
          <span className="stat">
            <strong>{stats?.totalChunks || 0}</strong> chunks
          </span>
          <span className="stat">
            <strong>{stats?.chunksWithEmbeddings || 0}</strong> con embedding
          </span>
        </div>

        <button
          className="sync-button"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw size={16} className={syncing ? 'spinner' : ''} />
          {syncing ? 'Sincronizzazione...' : 'Sincronizza'}
        </button>
      </div>

      {/* Certificate List */}
      {certificates.length === 0 ? (
        <div className="empty-state">
          <FileText size={48} />
          <p>Nessun certificato caricato</p>
          <span>Carica il tuo primo certificato usando il form sopra</span>
        </div>
      ) : (
        <div className="certificates">
          {certificates.map((cert) => (
            <div key={cert.id} className={`certificate-item ${cert.processingStatus}`}>
              <div className="cert-icon">
                <FileText size={24} />
              </div>

              <div className="cert-info">
                <div className="cert-title">{cert.title}</div>
                <div className="cert-meta">
                  <span className="brand">{cert.brand}</span>
                  <span className="separator">•</span>
                  <span className="pages">{cert.pageCount} pagine</span>
                  <span className="separator">•</span>
                  <span className="chunks">{cert.chunkCount} chunks</span>
                </div>
                {cert.metadata.reiValues && cert.metadata.reiValues.length > 0 && (
                  <div className="cert-tags">
                    {cert.metadata.reiValues.map((rei) => (
                      <span key={rei} className="tag rei">{rei}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="cert-status">
                {getStatusIcon(cert.processingStatus)}
                <span>{getStatusText(cert.processingStatus)}</span>
              </div>

              <div className="cert-actions">
                {cert.processingStatus === 'completed' && onViewPDF && (
                  <button
                    className="action-btn view"
                    onClick={() => onViewPDF(cert)}
                    title="Visualizza PDF"
                  >
                    <Eye size={18} />
                  </button>
                )}

                <button
                  className={`action-btn delete ${deleteConfirm === cert.id ? 'confirm' : ''}`}
                  onClick={() => handleDelete(cert)}
                  title={deleteConfirm === cert.id ? 'Conferma eliminazione' : 'Elimina'}
                >
                  <Trash2 size={18} />
                </button>
              </div>

              {cert.processingStatus === 'error' && cert.processingError && (
                <div className="cert-error">
                  <AlertCircle size={14} />
                  <span>{cert.processingError}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
