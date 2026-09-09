import { ClientDocumentService } from '../../src/services/business/client-document.service';
import { ClientService } from '../../src/services/business/client.service';
import { ProjectService } from '../../src/services/business/project.service';
import { getDbClient } from '../../src/utils/database';
import { Client } from '../../src/models/business/client.model';
import { TEST_USER_ID } from '../setup';

// The service reaches storage through a dynamic import; mocking the module
// keeps these tests off the network and out of the object store.
const uploadFile = jest.fn();
const deleteFileFromPath = jest.fn();
jest.mock('../../src/services/storage/storage.service', () => ({
  storageService: {
    uploadFile: (...args: any[]) => uploadFile(...args),
    deleteFileFromPath: (...args: any[]) => deleteFileFromPath(...args),
  },
}));

const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

function fakeFile(name = 'contract.pdf'): any {
  return {
    originalname: name,
    buffer: Buffer.from('%PDF-1.4 test'),
    mimetype: 'application/pdf',
    size: 13,
  };
}

describe('ClientDocumentService', () => {
  let service: ClientDocumentService;
  let clientService: ClientService;
  let projectService: ProjectService;
  let testClient: Client;
  const db = getDbClient();

  beforeAll(async () => {
    service = new ClientDocumentService();
    clientService = new ClientService();
    projectService = new ProjectService();

    // Mirrors the startup migration so the test is self-contained regardless of
    // the test container's init.sql vintage.
    await db.query(`
      CREATE TABLE IF NOT EXISTS client_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        document_type VARCHAR(50) NOT NULL DEFAULT 'contract'
          CHECK (document_type IN ('contract', 'amendment', 'nda', 'offer', 'order', 'invoice_terms', 'other')),
        file_url TEXT,
        file_filename VARCHAR(255),
        file_size INTEGER,
        file_mimetype VARCHAR(100),
        version INTEGER NOT NULL DEFAULT 1,
        supersedes_document_id UUID REFERENCES client_documents(id) ON DELETE SET NULL,
        signed_at DATE,
        valid_from DATE,
        valid_until DATE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  beforeEach(async () => {
    uploadFile.mockReset();
    deleteFileFromPath.mockReset();
    // storageService.uploadFile resolves to { url, filename, objectName }.
    uploadFile.mockImplementation(async (_u: string, _b: Buffer, name: string) => ({
      url: `/user-bucket/documents/clients/x/1-${name}`,
      filename: `1-${name}`,
      objectName: `documents/clients/x/1-${name}`,
    }));
    deleteFileFromPath.mockResolvedValue(undefined);

    testClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Doc Test Client' });
  });

  async function upload(overrides: any = {}, clientId?: string) {
    return service.createDocument(
      clientId ?? testClient.id,
      TEST_USER_ID,
      { title: 'Rahmenvertrag', ...overrides },
      fakeFile()
    );
  }

  describe('createDocument', () => {
    it('stores the document with its file metadata', async () => {
      const doc = await upload();

      expect(doc.id).toBeDefined();
      expect(doc.title).toBe('Rahmenvertrag');
      expect(doc.document_type).toBe('contract');
      expect(doc.version).toBe(1);
      expect(doc.file_mimetype).toBe('application/pdf');
      expect(doc.file_url).toContain('documents/clients/');
      expect(uploadFile).toHaveBeenCalledTimes(1);
    });

    it('refuses a client owned by someone else', async () => {
      await expect(
        service.createDocument(testClient.id, OTHER_USER_ID, { title: 'Sneaky' }, fakeFile())
      ).rejects.toThrow(/not found or unauthorized/i);
    });

    it('refuses a project that belongs to a different client', async () => {
      const otherClient = await clientService.create({ user_id: TEST_USER_ID, name: 'Other Client' });
      const foreignProject = await projectService.create({
        user_id: TEST_USER_ID,
        name: 'Foreign Project',
        client_id: otherClient.id,
      });

      await expect(
        upload({ project_id: foreignProject.id })
      ).rejects.toThrow(/does not belong to this client/i);
    });

    it('accepts a project of the same client', async () => {
      const project = await projectService.create({
        user_id: TEST_USER_ID,
        name: 'Own Project',
        client_id: testClient.id,
      });

      const doc = await upload({ project_id: project.id });

      expect(doc.project_id).toBe(project.id);
    });
  });

  describe('versioning', () => {
    it('increments the version and keeps the predecessor intact', async () => {
      const v1 = await upload({ title: 'Vertrag 2025' });
      const v2 = await upload({ title: 'Vertrag 2026', supersedes_document_id: v1.id });

      expect(v2.version).toBe(2);
      expect(v2.supersedes_document_id).toBe(v1.id);

      // The superseded contract must stay downloadable.
      const stillThere = await service.getDocumentById(v1.id, TEST_USER_ID);
      expect(stillThere).not.toBeNull();
      expect(stillThere?.file_url).toBe(v1.file_url);
      expect(deleteFileFromPath).not.toHaveBeenCalled();
    });
  });

  describe('getDocumentsByClient', () => {
    it('lists the client documents', async () => {
      await upload({ title: 'A' });
      await upload({ title: 'B' });

      const docs = await service.getDocumentsByClient(testClient.id, TEST_USER_ID, {});

      expect(docs).toHaveLength(2);
    });

    it('filters by document type', async () => {
      await upload({ title: 'A', document_type: 'contract' });
      await upload({ title: 'B', document_type: 'nda' });

      const ndas = await service.getDocumentsByClient(testClient.id, TEST_USER_ID, {
        document_type: 'nda',
      } as any);

      expect(ndas).toHaveLength(1);
      expect(ndas[0].title).toBe('B');
    });

    it('refuses to list another tenant documents', async () => {
      await upload();

      await expect(
        service.getDocumentsByClient(testClient.id, OTHER_USER_ID, {})
      ).rejects.toThrow(/not found or unauthorized/i);
    });
  });

  describe('getDocumentById', () => {
    it('does not leak another tenant document', async () => {
      const doc = await upload();

      expect(await service.getDocumentById(doc.id, OTHER_USER_ID)).toBeNull();
    });
  });

  describe('updateDocument', () => {
    it('updates metadata', async () => {
      const doc = await upload();

      const updated = await service.updateDocument(doc.id, TEST_USER_ID, {
        title: 'Rahmenvertrag (korrigiert)',
        notes: 'Scan nachgereicht',
      });

      expect(updated?.title).toBe('Rahmenvertrag (korrigiert)');
      expect(updated?.notes).toBe('Scan nachgereicht');
    });

    it('refuses to update another tenant document', async () => {
      const doc = await upload();

      await expect(
        service.updateDocument(doc.id, OTHER_USER_ID, { title: 'Hijacked' })
      ).rejects.toThrow();

      const untouched = await service.getDocumentById(doc.id, TEST_USER_ID);
      expect(untouched?.title).toBe('Rahmenvertrag');
    });
  });

  describe('deleteDocument', () => {
    it('removes the row and its stored file', async () => {
      const doc = await upload();

      await service.deleteDocument(doc.id, TEST_USER_ID);

      expect(await service.getDocumentById(doc.id, TEST_USER_ID)).toBeNull();
      expect(deleteFileFromPath).toHaveBeenCalledWith(doc.file_url);
    });

    it('refuses to delete another tenant document', async () => {
      const doc = await upload();

      await expect(service.deleteDocument(doc.id, OTHER_USER_ID)).rejects.toThrow();
      expect(await service.getDocumentById(doc.id, TEST_USER_ID)).not.toBeNull();
    });
  });
});
