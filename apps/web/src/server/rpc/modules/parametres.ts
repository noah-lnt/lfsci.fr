import "server-only";
import { eq } from "drizzle-orm";
import { SecurityStatus } from "@/lib/contracts/parametres";
import { twoFactor } from "../../auth-schema";
import { authed, validated } from "../base";

/** better-auth 1.7.5 ships no passkey plugin; adding one means adding a package. */
const PASSKEYS_SUPPORTED = false;

export const parametresRouter = {
  parametres: {
    securite: authed.parametres.securite
      .use(validated(SecurityStatus))
      .handler(async ({ context }) => {
        const rows = await context.db
          .select({ backupCodes: twoFactor.backupCodes })
          .from(twoFactor)
          .where(eq(twoFactor.userId, context.session.user.id))
          .limit(1);
        return {
          email: context.session.user.email,
          twoFactorEnabled:
            (context.session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled ??
            false,
          hasBackupCodes: (rows[0]?.backupCodes ?? "").length > 0,
          passkeysSupported: PASSKEYS_SUPPORTED,
        };
      }),
  },
};
