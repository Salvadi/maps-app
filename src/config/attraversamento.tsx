export interface MenuOption {
  value: string;
  label: string;
}

export const ATTRAVERSAMENTO_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'cavi_corrugati', label: 'Cavi/Corrugati' },
  { value: 'fascio_cavi', label: 'Fascio di cavi' },
  { value: 'canalina_passacavi', label: 'Canalina passacavi' },
  { value: 'tubo_combustibile', label: 'Tubo combustibile' },
  { value: 'tubo_multistrato', label: 'Tubo multistrato' },
  { value: 'tubo_incombustibile_nudo', label: 'Tubo incombustibile NUDO' },
  { value: 'tubo_incombustibile_isolato', label: 'Tubo incombustibile ISOLATO combustibile' },
  { value: 'tubo_rame_isolato', label: 'Tubo RAME isolato' },
  { value: 'tubo_areazione_lamiera', label: 'Tubo areazione in lamiera' },
  { value: 'tubo_areazione_spiralato', label: 'Tubo areazione spiralato' },
  { value: 'serranda', label: 'Serranda' },
  { value: 'asola', label: 'Asola' },
];
