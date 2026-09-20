import { z } from "zod";

export const ErrorCode = z.enum([
  "VALIDATION",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "APPROVAL_REQUIRED",
  "APPROVAL_INVALID",
  "PERIOD_LOCKED",
  "RULE_VIOLATION",
  "AMBIGUOUS_REFERENCE",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_REJECTED",
  "RESULT_UNKNOWN",
  "QUOTA_EXCEEDED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA",
  "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const httpStatusByCode: Record<ErrorCode, number> = {
  VALIDATION: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  APPROVAL_REQUIRED: 409,
  APPROVAL_INVALID: 409,
  PERIOD_LOCKED: 409,
  RULE_VIOLATION: 422,
  AMBIGUOUS_REFERENCE: 409,
  UPSTREAM_UNAVAILABLE: 503,
  UPSTREAM_REJECTED: 502,
  RESULT_UNKNOWN: 502,
  QUOTA_EXCEEDED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  INTERNAL: 500,
};

export const messageByCode: Record<ErrorCode, string> = {
  VALIDATION: "Les données envoyées sont invalides.",
  UNAUTHENTICATED: "Connexion requise.",
  FORBIDDEN: "Action non autorisée.",
  NOT_FOUND: "Élément introuvable.",
  CONFLICT: "L’opération entre en conflit avec l’état actuel.",
  VERSION_CONFLICT: "L’élément a été modifié entre-temps ; rechargez-le.",
  IDEMPOTENCY_KEY_REUSED: "Cette opération a déjà été soumise avec un contenu différent.",
  APPROVAL_REQUIRED: "Cette action nécessite une validation.",
  APPROVAL_INVALID: "La validation n’est plus valable ; l’élément a changé.",
  PERIOD_LOCKED: "La période comptable est verrouillée.",
  RULE_VIOLATION: "Une règle métier empêche cette action.",
  AMBIGUOUS_REFERENCE: "Plusieurs éléments correspondent ; précisez la cible.",
  UPSTREAM_UNAVAILABLE: "Un service externe est indisponible ; réessayez plus tard.",
  UPSTREAM_REJECTED: "Le service externe a refusé l’opération.",
  RESULT_UNKNOWN: "Le résultat de l’opération est inconnu ; une vérification est en cours.",
  QUOTA_EXCEEDED: "Quota dépassé ; réessayez plus tard.",
  PAYLOAD_TOO_LARGE: "Le fichier est trop volumineux.",
  UNSUPPORTED_MEDIA: "Type de fichier non pris en charge.",
  INTERNAL: "Erreur interne ; la référence ci-dessous permet de la retrouver.",
};

export const ErrorPayload = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayload>;
