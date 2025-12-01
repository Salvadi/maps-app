export interface MenuOption {
  value: string;
  label: string;
}

export const ATTRAVERSAMENTO_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'Cavi/Corrugati', label: 'Cavi/Corrugati' },
  { value: 'Fascio di cavi', label: 'Fascio di cavi' },
  { value: 'Canalina passacavi', label: 'Canalina passacavi' },
  
  { value: 'Tubo combustibile', label: 'Tubo combustibile' },
  { value: 'Tubo multistrato', label: 'Tubo multistrato' },
  
  { value: 'Tubo metallico NUDO', label: 'Tubo metallico NUDO' },
  { value: 'Tubo metallico ISOLATO Armaflex', label: 'Tubo metallico ISOLATO Armaflex' },
  { value: 'Tubo metallico ISOLATO lana', label: 'Tubo metallico ISOLATO lana' },

  { value: 'Tubo RAME isolato Armaflex', label: 'Tubo RAME isolato Armaflex' },
  { value: 'Tubo RAME nudo', label: 'Tubo RAME nudo' },

  { value: 'Tubo areazione in lamiera', label: 'Tubo areazione in lamiera' },
  { value: 'Tubo areazione spiralato', label: 'Tubo areazione spiralato' },

  { value: 'Serranda', label: 'Serranda' },
  { value: 'Canala areazione', label: 'Canala areazione' },

  { value: 'Asola', label: 'Asola' },

  { value: 'Altro', label: 'Altro' },
];

];
