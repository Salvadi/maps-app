export interface MenuOption {
  value: string;
  label: string;
}

export const TIPO_SUPPORTO_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'brick', label: 'Mattoni' },
  { value: 'concrete', label: 'Cemento' },
  { value: 'wood', label: 'Legno' },
  { value: 'steel', label: 'Acciaio' },
  { value: 'plasterboard', label: 'Cartongesso' },
];
