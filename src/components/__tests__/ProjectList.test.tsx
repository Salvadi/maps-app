import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectList from '../ProjectList';

jest.mock('../../db', () => ({
  __esModule: true,
  getAllProjects: jest.fn(),
  getProjectsForUser: jest.fn(),
  db: {
    mappingEntries: {
      toArray: jest.fn().mockResolvedValue([]),
    },
  },
}));

const { getAllProjects } = jest.requireMock('../../db') as {
  getAllProjects: jest.Mock;
};
const { db } = jest.requireMock('../../db') as {
  db: { mappingEntries: { toArray: jest.Mock } };
};

describe('ProjectList', () => {
  beforeEach(() => {
    db.mappingEntries.toArray.mockResolvedValue([]);
    getAllProjects.mockResolvedValue([
      {
        id: 'archived-cx',
        title: 'CX Place',
        client: 'Cliente CX',
        address: 'Via Roma 1',
        archived: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        floors: [],
      },
    ]);
  });

  it('keeps archived projects hidden in "Tutti" until a matching search query is entered', async () => {
    render(
      <ProjectList
        currentUser={{ id: 'admin', role: 'admin' } as any}
        onEditProject={jest.fn()}
        onDeleteProject={jest.fn()}
        onViewProject={jest.fn()}
        onEnterMapping={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Nessun progetto trovato')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Cerca per nome, cliente o indirizzo...');
    await userEvent.type(searchInput, 'CX');

    expect(screen.getByText('CX Place')).toBeInTheDocument();
  });
});
