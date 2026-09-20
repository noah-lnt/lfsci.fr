import type { RpcContext } from "../rpc/context";

export type TenantScope = Pick<RpcContext, "requestId" | "session"> & { organizationId: string };
