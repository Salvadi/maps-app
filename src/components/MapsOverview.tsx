import React, { useState, useEffect } from 'react';
import { Map, FolderOpen, Plus, ChevronRight, FileDown, RefreshCw } from 'lucide-react';
import {
  Project, User, FloorPlan,
  getAllProjects, getProjectsForUser, getFloorPlansByProject, getFloorPlanPoints, ensureFloorPlanAsset
} from '../db';
import { exportFloorPlanVectorPDF, ExportPoint } from '../utils/exportUtils';
import { useBlobUrl } from '../hooks/useBlobUrl';

interface MapsOverviewProps {
  currentUser: User;
  onOpenFloorPlan: (project: Project, floorPlan: FloorPlan) => void;
  onOpenStandaloneEditor: () => void;
  onNavigateToProject: (project: Project) => void;
}

interface ProjectWithPlans {
  project: Project;
  floorPlans: FloorPlan[];
}

const MapsOverview: React.FC<MapsOverviewProps> = ({
  currentUser,
  onOpenFloorPlan,
  onOpenStandaloneEditor,
  onNavigateToProject,
}) => {
  const [projectsWithPlans, setProjectsWithPlans] = useState<ProjectWithPlans[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [exportingPlanId, setExportingPlanId] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      const projects = currentUser.role === 'admin'
        ? await getAllProjects()
        : await getProjectsForUser(currentUser.id);

      const activeProjects = projects.filter(p => p.archived === 0);
      const result: ProjectWithPlans[] = [];

      for (const project of activeProjects) {
        const plans = await getFloorPlansByProject(project.id);
        if (plans.length > 0) {
          result.push({ project, floorPlans: plans });
        }
      }

      setProjectsWithPlans(result);
      setIsLoading(false);
    };
    loadData();
  }, [currentUser]);

  const totalPlans = projectsWithPlans.reduce((sum, p) => sum + p.floorPlans.length, 0);

  const handleExportPlanPDF = async (_project: Project, plan: FloorPlan) => {
    setExportingPlanId(plan.id);
    try {
      const hydratedPlan = await ensureFloorPlanAsset(plan.id, 'full');
      const exportReadyPlan = hydratedPlan ? await ensureFloorPlanAsset(plan.id, 'pdf') : undefined;
      if (!exportReadyPlan?.imageBlob) {
        return;
      }
      const rawPoints = await getFloorPlanPoints(plan.id);
      const exportPoints: ExportPoint[] = rawPoints.map(point => ({
        type: point.pointType,
        pointX: point.pointX,
        pointY: point.pointY,
        labelX: point.labelX,
        labelY: point.labelY,
        labelText: point.metadata?.labelText || ['Punto'],
        perimeterPoints: point.perimeterPoints,
        labelBackgroundColor: point.metadata?.labelBackgroundColor,
        labelTextColor: point.metadata?.labelTextColor,
      }));
      await exportFloorPlanVectorPDF(
        exportReadyPlan.imageBlob,
        exportPoints,
        `Piano_${plan.floor}_annotato.pdf`,
        exportReadyPlan.pdfBlobBase64,
        exportReadyPlan.metadata?.rotation || 0,
      );
    } finally {
      setExportingPlanId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
      {/* Header */}
      <div className="px-5 pt-6 pb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">Planimetrie</h1>
          <p className="text-sm text-brand-500 mt-0.5">
            {totalPlans} planimetri{totalPlans === 1 ? 'a' : 'e'} in {projectsWithPlans.length} progett{projectsWithPlans.length === 1 ? 'o' : 'i'}
          </p>
        </div>
        <button
          onClick={onOpenStandaloneEditor}
          className="inline-flex items-center gap-2 rounded-xl bg-white border border-brand-200 px-3 py-2 text-sm font-semibold text-brand-700 shadow-card hover:border-accent/40 hover:text-accent transition-colors flex-shrink-0"
        >
          <Plus size={16} />
          Nuova mappa standalone
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-brand-500 text-sm">
          Caricamento planimetrie...
        </div>
      ) : (
        <div className="px-5 space-y-5">
          {/* Plans by project */}
          {projectsWithPlans.map(({ project, floorPlans }) => (
            <div key={project.id}>
              <button
                onClick={() => onNavigateToProject(project)}
                className="flex items-center gap-2 mb-2.5 px-1 group"
              >
                <FolderOpen size={14} className="text-brand-500" />
                <span className="text-sm font-semibold text-brand-700 group-hover:text-accent transition-colors">
                  {project.title}
                </span>
                <ChevronRight size={14} className="text-brand-400" />
              </button>
              <div className="grid grid-cols-2 gap-3">
                {floorPlans.map((plan) => (
                  <div key={plan.id} className="bg-white rounded-2xl shadow-card overflow-hidden">
                    <button
                      onClick={() => onOpenFloorPlan(project, plan)}
                      className="w-full active:scale-[0.98] transition-transform"
                    >
                      <div className="aspect-[4/3] bg-brand-50 flex items-center justify-center">
                        <ThumbnailImage blob={plan.thumbnailBlob} remoteUrl={plan.thumbnailUrl || plan.imageUrl} alt={`Piano ${plan.floor}`} />
                      </div>
                    </button>
                    <div className="px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-brand-700">Piano {plan.floor}</div>
                        <div className="text-[11px] text-brand-500 truncate max-w-[90px]">
                          {plan.originalFilename || 'Planimetria'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleExportPlanPDF(project, plan)}
                        disabled={exportingPlanId === plan.id}
                        title="Scarica PDF"
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-accent hover:bg-accent/10 disabled:opacity-40 flex-shrink-0"
                      >
                        {exportingPlanId === plan.id
                          ? <RefreshCw size={13} className="animate-spin" />
                          : <FileDown size={14} />
                        }
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {projectsWithPlans.length === 0 && (
            <div className="text-center py-12">
              <Map size={48} className="mx-auto text-brand-300 mb-3" />
              <p className="text-brand-500 text-sm">Nessuna planimetria presente</p>
              <p className="text-brand-400 text-xs mt-1">
                Carica una planimetria da un progetto
              </p>
            </div>
          )}
        </div>
      )}

      <div className="h-4" />
    </div>
  );
};

/** Sub-component that manages Blob URL lifecycle for a thumbnail */
const ThumbnailImage: React.FC<{ blob: Blob | undefined; remoteUrl?: string; alt: string }> = ({ blob, remoteUrl, alt }) => {
  const url = useBlobUrl(blob);
  const imageUrl = url || remoteUrl;
  if (!imageUrl) return <Map size={32} className="text-brand-300" />;
  return <img src={imageUrl} alt={alt} className="w-full h-full object-cover" />;
};

export default MapsOverview;
