import "server-only";
import { paginated } from "@lfsci/contracts";
import { z } from "zod";
import {
  AssurancesLookups,
  AttachAttestationResult,
  AttestationCandidate,
  ClaimDetail,
  ClaimRow,
  PolicyDetail,
  PolicyExceptionRow,
  PolicyRow,
} from "@/lib/contracts/assurances";
import { attachAttestation, listAttestationCandidates } from "../../assurances/attestations";
import {
  createClaim,
  getClaim,
  linkClaimIntervention,
  listClaims,
  updateClaim,
} from "../../assurances/claims";
import { assurancesLookups } from "../../assurances/lookups";
import {
  addPolicyScope,
  closePolicyScope,
  createPolicy,
  getPolicy,
  listPolicies,
  listPolicyExceptions,
  updatePolicy,
} from "../../assurances/policies";
import { tenant } from "../../data";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

type Scoped = RpcContext & { organizationId: string };

function actorOf(context: Scoped) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.session?.user.id ?? null,
  };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

const exceptionsOutput = z.object({ items: z.array(PolicyExceptionRow) });
const candidatesOutput = z.object({ items: z.array(AttestationCandidate) });

export const assurancesRouter = {
  assurances: {
    lookups: withOrganization.assurances.lookups
      .use(validated(AssurancesLookups))
      .handler(({ context }) => tenant(scope(context), (tx) => assurancesLookups(tx))),
    policies: {
      list: withOrganization.assurances.policies.list
        .use(validated(paginated(PolicyRow)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listPolicies(tx, input))),
      get: withOrganization.assurances.policies.get
        .use(validated(PolicyDetail))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getPolicy(tx, input.id))),
      create: withOrganization.assurances.policies.create
        .use(validated(PolicyDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createPolicy(tx, actorOf(context), input)),
        ),
      update: withOrganization.assurances.policies.update
        .use(validated(PolicyDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updatePolicy(tx, actorOf(context), input)),
        ),
      exceptions: withOrganization.assurances.policies.exceptions
        .use(validated(exceptionsOutput))
        .handler(({ context }) => tenant(scope(context), (tx) => listPolicyExceptions(tx))),
      scopes: {
        add: withOrganization.assurances.policies.scopes.add
          .use(validated(PolicyDetail))
          .handler(({ context, input }) =>
            tenant(scope(context), (tx) => addPolicyScope(tx, actorOf(context), input)),
          ),
        close: withOrganization.assurances.policies.scopes.close
          .use(validated(PolicyDetail))
          .handler(({ context, input }) =>
            tenant(scope(context), (tx) => closePolicyScope(tx, actorOf(context), input)),
          ),
      },
    },
    attestations: {
      list: withOrganization.assurances.attestations.list
        .use(validated(candidatesOutput))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => listAttestationCandidates(tx, input.limit)),
        ),
      attach: withOrganization.assurances.attestations.attach
        .use(validated(AttachAttestationResult))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => attachAttestation(tx, actorOf(context), input)),
        ),
    },
    claims: {
      list: withOrganization.assurances.claims.list
        .use(validated(paginated(ClaimRow)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listClaims(tx, input))),
      get: withOrganization.assurances.claims.get
        .use(validated(ClaimDetail))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getClaim(tx, input.id))),
      create: withOrganization.assurances.claims.create
        .use(validated(ClaimDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createClaim(tx, actorOf(context), input)),
        ),
      update: withOrganization.assurances.claims.update
        .use(validated(ClaimDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateClaim(tx, actorOf(context), input)),
        ),
      linkIntervention: withOrganization.assurances.claims.linkIntervention
        .use(validated(ClaimDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => linkClaimIntervention(tx, actorOf(context), input)),
        ),
    },
  },
};
