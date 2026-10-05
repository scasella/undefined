import { describe, expect, it } from 'vitest';
import type { EngineState } from '@scasella/undefined-engine/types';
import { openDataFile } from './DataStart';
import { suggestionTitle } from '../data';
import { dataDrawerOpen, dataFilename, dataProblem, dataText } from '../uiState';

const state = { program: { functions: {} }, datasets: [] } as unknown as EngineState;

describe('the first screen data way in', () => {
  it('a file that cannot be used keeps the draft already pasted and says why', async () => {
    dataText.value = 'a,b\n1,2\n';
    dataFilename.value = undefined;
    dataProblem.value = null;
    await openDataFile(new File(['PK\u0003\u0004'], 'book.xlsx'), state);
    expect(dataText.value).toBe('a,b\n1,2\n');
    expect(dataProblem.value).toBe('book.xlsx is a spreadsheet file; export it as CSV.');
    expect(dataDrawerOpen.value).toBe(true);
    await openDataFile(new File(['  \n'], 'empty.csv'), state);
    expect(dataText.value).toBe('a,b\n1,2\n');
    expect(dataProblem.value).toBe('empty.csv is empty. Nothing to load.');
  });

  it('a usable file replaces the draft and clears the problem', async () => {
    await openDataFile(new File(['x,y\n1,2\n'], 'Sales Q3.csv'), state);
    expect(dataText.value).toBe('x,y\n1,2\n');
    expect(dataFilename.value).toBe('Sales Q3.csv');
    expect(dataProblem.value).toBeNull();
  });

  it('a suggested call promises a written function only in live mode', () => {
    const s = { fn: 'countByStatus', what: 'how many rows per status' };
    expect(suggestionTitle(s, 'live')).toContain('press Enter and it is written for you');
    expect(suggestionTitle(s, 'replay')).not.toContain('written for you');
    expect(suggestionTitle(s, 'replay')).toContain('needs live mode');
  });
});
