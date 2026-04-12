import React, { useState, useEffect } from 'react';
import { Map, FolderOpen, Plus, ChevronRight, FileDown, RefreshCw } from 'lucide-react';
import {
  Project, User, FloorPlan,
  getAllProjects, getProjectsForUser, getFloorPlansByProject, getFloorPlanPoints
} from '../db';
import { exportFloorPlanVectorPDF, ExportPoint } from '../utils/exportUtils';

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

  const handleExportPlanPDF = async (plan: FloorPlan) => {
    if (!plan.imageBlob) return;
    setExportingPlanId(plan.id);
    try {
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
        plan.imageBlob,
        exportPoints,
        `Piano_${plan.floor}_annotato.pdf`,
        plan.pdfBlobBase64,
        plan.metadata?.rotation || 0,
      );
    } finally {
      setExportingPlanId(null);
    }
  };

  return (
    <div className="flex-1 overflow-auto pb-20 bg-brand-100">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-brand-800">Planimetrie</h1>
        <p className="text-sm text-brand-500 mt-0.5">
          {totalPlans} planimetri{totalPlans === 1 ? 'a' : 'e'} in {projectsWithPlans.length} progett{projectsWithPlans.length === 1 ? 'o' : 'i'}
        </p>
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
                        {plan.thumbnailBlob ? (
                          <img
                            src={URL.createObjectURL(plan.thumbnailBlob)}
                            alt={`Piano ${plan.floor}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Map size={32} className="text-brand-300" />
                        )}
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
                        onClick={() => handleExportPlanPDF(plan)}
                        disabled={exportingPlanId === plan.id || !plan.imageBlob}
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

          {/* Standalone editor button */}
          <div className="mt-6">
            <h2 className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-2 px-1">
              Mappe standalone
            </h2>
            <button
              onClick={onOpenStandaloneEditor}
              className="w-full bg-white rounded-2xl shadow-card p-4 flex items-center gap-3 active:scale-[0.99] transition-transform"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                <Plus size={18} className="text-accent" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-brand-700">Editor Mappa Standalone</div>
                <div className="text-xs text-brand-500">Crea una mappa indipendente dai progetti</div>
              </div>
              <ChevronRight size={16} className="text-brand-400 ml-auto" />
            </button>
          </div>
        </div>
      )}

      <div className="h-4" />
    </div>
  );
};

export default MapsOverview;
