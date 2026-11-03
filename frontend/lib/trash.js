import { api, refreshAccount } from './api.js';
import { toast } from './ui.js';

/**
 * Move files/folders to the trash and offer Undo.
 * `onChange` runs after the move and again after an undo, to refresh the page.
 */
export async function moveToTrash({ files = [], folders = [] }, label, onChange = () => {}) {
  if (!files.length && !folders.length) return false;
  try {
    await api('/api/items/trash', { method: 'POST', body: { files, folders } });
  } catch (e) { toast.error(e.message); return false; }
  await onChange();
  refreshAccount();
  toast.undo(`${label} moved to the trash`, async () => {
    try {
      await api('/api/trash/restore', { method: 'POST', body: { files, folders } });
      await onChange();
      refreshAccount();
      toast.success('Restored');
    } catch (e) { toast.error(e.message); }
  });
  return true;
}

export const countLabel = (nFiles, nFolders = 0, noun = 'file') => [
  nFiles && `${nFiles} ${noun}${nFiles > 1 ? 's' : ''}`,
  nFolders && `${nFolders} folder${nFolders > 1 ? 's' : ''}`,
].filter(Boolean).join(' and ');
