import "server-only";
import { api, DocumentEntity } from "@lfsci/contracts";
import { tenant } from "../../data";
import * as repository from "../../documents/repository";
import * as uploads from "../../documents/uploads";
import { documentStore } from "../../storage";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

function scope(
  context: RpcContext & {
    organizationId: string;
    session: NonNullable<RpcContext["session"]>;
  },
) {
  return { organizationId: context.organizationId, actorId: context.session.user.id };
}

export const documentsRouter = {
  documents: {
    list: withOrganization.documents.list
      .use(validated(api.documents.listDocuments.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) =>
          repository.listDocuments(tx, {
            limit: input.limit,
            cursor: input.cursor,
            nature: input.nature,
            status: input.status,
            search: input.search,
            object: input.object,
            periodFrom: input.periodFrom,
            periodTo: input.periodTo,
          }),
        ),
      ),
    get: withOrganization.documents.get
      .use(validated(api.documents.getDocument.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) => repository.getDocument(tx, input.id)),
      ),
    createUpload: withOrganization.documents.createUpload
      .use(validated(api.documents.createUpload.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) => uploads.createUpload(tx, scope(context), documentStore(), input)),
      ),
    finalizeUpload: withOrganization.documents.finalizeUpload
      .use(validated(api.documents.finalizeUpload.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) => uploads.finalizeUpload(tx, scope(context), documentStore(), input)),
      ),
    download: withOrganization.documents.download
      .use(validated(api.documents.getDownloadUrl.output))
      .handler(({ context, input }) =>
        tenant(context, (tx) => uploads.downloadUrl(tx, scope(context), documentStore(), input.id)),
      ),
    link: withOrganization.documents.link
      .use(validated(DocumentEntity))
      .handler(({ context, input }) =>
        tenant(context, (tx) => repository.linkDocument(tx, scope(context), input)),
      ),
  },
};
