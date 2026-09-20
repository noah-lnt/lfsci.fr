import { oc } from "@orpc/contract";
import { z } from "zod";

/**
 * SEC-02. Enrolment itself goes through the better-auth endpoints, which own
 * the TOTP secret and the backup codes; this read is what the screen renders
 * around them.
 */
export const SecurityStatus = z.object({
  email: z.string(),
  twoFactorEnabled: z.boolean(),
  hasBackupCodes: z.boolean(),
  passkeysSupported: z.boolean(),
});
export type SecurityStatus = z.infer<typeof SecurityStatus>;

export const parametresContract = {
  parametres: {
    securite: oc
      .route({ method: "GET", path: "/parametres/securite", summary: "Sécurité du compte" })
      .output(SecurityStatus),
  },
};
