import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import useUnlinkGithubIdentity from "@/hooks/mutations/user/use-unlink-github-identity";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import useGetGithubIdentity from "@/hooks/queries/user/use-get-github-identity";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

/**
 * Connects the signed-in user's GitHub account so assignment can name the same
 * person on both sides.
 *
 * Connecting runs GitHub's OAuth flow for the account already signed in, which
 * is what proves the GitHub account is theirs. It is not a way to sign in, and
 * it does not change how they log in.
 */
function GithubIdentityCard() {
  const { t } = useTranslation();
  const { data: config } = useGetConfig();
  const { data, isPending } = useGetGithubIdentity();
  const { mutateAsync: forgetIdentity } = useUnlinkGithubIdentity();
  const [isWorking, setIsWorking] = useState(false);

  const linkedLogin = data?.identity?.githubLogin ?? null;
  const canConnect = config?.hasGithubSignIn ?? false;

  const handleConnect = async () => {
    setIsWorking(true);
    try {
      const result = await authClient.linkSocial({
        provider: "github",
        callbackURL: window.location.href,
      });
      if (result.error) throw new Error(result.error.message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.githubIdentity.connectFailed"),
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleDisconnect = async () => {
    setIsWorking(true);
    try {
      // Revoking the provider account is the real disconnect; our own row is
      // only a cache of the handle, and would be seeded again from the
      // account row on the next read if it were the only thing removed.
      const result = await authClient.unlinkAccount({ providerId: "github" });

      if (result.error) {
        // Unlinking needs a fresh session, the same as deleting an account.
        if (result.error.code === "SESSION_EXPIRED") {
          toast.error(
            t("settings:informationPage.githubIdentity.sessionTooOld"),
          );
          return;
        }

        // Refused when GitHub is the only way this user can sign in, which
        // would otherwise lock them out of Kaneo entirely.
        if (result.error.code === "FAILED_TO_UNLINK_LAST_ACCOUNT") {
          toast.error(t("settings:informationPage.githubIdentity.onlyAccount"));
          return;
        }

        throw new Error(result.error.message);
      }

      await forgetIdentity();
      toast.success(t("settings:informationPage.githubIdentity.disconnected"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.githubIdentity.disconnectFailed"),
      );
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-md font-medium">
          {t("settings:informationPage.githubIdentity.sectionTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings:informationPage.githubIdentity.sectionSubtitle")}
        </p>
      </div>

      <div className="space-y-4 border border-border rounded-md p-4 bg-sidebar">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-center gap-3">
            <GithubIcon className="size-5 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {linkedLogin
                  ? t("settings:informationPage.githubIdentity.connectedAs", {
                      login: linkedLogin,
                    })
                  : t("settings:informationPage.githubIdentity.notConnected")}
              </p>
              <p className="text-xs text-muted-foreground">
                {!canConnect
                  ? t("settings:informationPage.githubIdentity.unavailable")
                  : linkedLogin
                    ? t("settings:informationPage.githubIdentity.connectedHint")
                    : t(
                        "settings:informationPage.githubIdentity.notConnectedHint",
                      )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {isPending ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : linkedLogin ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={isWorking}
                onClick={handleDisconnect}
              >
                {t("settings:informationPage.githubIdentity.disconnect")}
              </Button>
            ) : (
              <Button
                size="sm"
                type="button"
                disabled={isWorking || !canConnect}
                onClick={handleConnect}
              >
                {isWorking
                  ? t("settings:informationPage.githubIdentity.connecting")
                  : t("settings:informationPage.githubIdentity.connect")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GithubIdentityCard;
