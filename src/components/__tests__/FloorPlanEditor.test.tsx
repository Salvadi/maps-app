import React from 'react';
import { render, screen } from '@testing-library/react';
import FloorPlanEditor from '../FloorPlanEditor';

jest.mock('../FloorPlanCanvas', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((_props: any, _ref: any) => (
      <div data-testid="mock-canvas" />
    )),
  };
});

jest.mock('../ColorPickerModal', () => ({
  __esModule: true,
  default: () => null,
}));

test('in mode standalone il menu export mostra solo il bottone PDF', () => {
  render(
    <FloorPlanEditor
      imageUrl="data:image/png;base64,abc"
      mode="standalone"
      onSaveFile={jest.fn()}
    />
  );

  expect(screen.getByText('PDF')).toBeInTheDocument();
  expect(screen.queryByText('PNG')).not.toBeInTheDocument();
  expect(screen.queryByText('JSON')).not.toBeInTheDocument();
});

test('mostra il cartiglio editabile con righe tipologici del progetto', () => {
  render(
    <FloorPlanEditor
      imageUrl="data:image/png;base64,abc"
      mode="view-edit"
      typologyNumbers={[1, 3, 7]}
      defaultTavola="0"
      defaultCommittente="Cliente Test - Via Roma 1"
    />
  );

  expect(screen.getByText('Cartiglio planimetria')).toBeInTheDocument();
  expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Cliente Test - Via Roma 1')).toBeInTheDocument();
  expect(screen.getByText('1)')).toBeInTheDocument();
  expect(screen.getByText('3)')).toBeInTheDocument();
  expect(screen.getByText('7)')).toBeInTheDocument();
});
