export interface MenuOption {
  value: string;
  label: string;
}

export const TIPO_SUPPORTO_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'Cartongesso', label: 'Cartongesso' },
  { value: 'Cemento', label: 'Cemento' },
  { value: 'Laterizio intonacato', label: 'Laterizio intonacato' },
  { value: 'Laterizio NON intonacato', label: 'Laterizio NON intonacato' },
  { value: 'Legno', label: 'Legno' },
];
