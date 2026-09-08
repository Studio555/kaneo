import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useLinkGithubIdentity from "@/hooks/mutations/user/use-link-github-identity";
import useUnlinkGithubIdentity from "@/hooks/mutations/user/use-unlink-github-identity";
import useGetGithubIdentity from "@/hooks/queries/user/use-get-github-identity";
import { toast } from "@/lib/toast";

/**
 * Links the signed-in user to a GitHub account so assigning a task also
 * assigns the linked GitHub issue to the same person. Signing in with GitHub
 * fills this in on its own; the field is here for everyone else.
 */
function GithubIdentityCard() {
  const { t } = useTranslation();
  const { data, isPending } = useGetGithubIdentity();
  const { mutateAsync: linkIdentity, isPending: isLinking } =
    useLinkGithubIdentity();
  const { mutateAsync: unlinkIdentity, isPending: isUnlinking } =
    useUnlinkGithubIdentity();

  const linkedLogin = data?.identity?.githubLogin ?? null;
  const isVerified = data?.identity?.verified ?? false;
  const [login, setLogin] = useState("");

  // The link can arrive after first paint, and is seeded from GitHub SSO
  // without the user typing anything, so the field follows the server value.
  useEffect(() => {
    setLogin(linkedLogin ?? "");
  }, [linkedLogin]);

  const trimmedLogin = login.trim();
  const isBusy = isLinking || isUnlinking;
  const canSave = trimmedLogin !== "" && trimmedLogin !== linkedLogin;

  const handleSave = async () => {
    try {
      await linkIdentity({ login: trimmedLogin });
      toast.success(t("settings:informationPage.githubIdentity.linked"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.githubIdentity.linkFailed"),
      );
    }
  };

  const handleUnlink = async () => {
    try {
      await unlinkIdentity();
      setLogin("");
      toast.success(t("settings:informationPage.githubIdentity.unlinked"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:informationPage.githubIdentity.unlinkFailed"),
      );
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div className="w-full space-y-2 sm:w-auto sm:flex-1">
            <Label
              htmlFor="github-identity-login"
              className="text-sm font-medium"
            >
              {t("settings:informationPage.githubIdentity.label")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="github-identity-login"
                className="w-full sm:w-64"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={isPending || isBusy}
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder={t(
                  "settings:informationPage.githubIdentity.placeholder",
                )}
              />
              {isPending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {linkedLogin
                ? t(
                    isVerified
                      ? "settings:informationPage.githubIdentity.connectedVerified"
                      : "settings:informationPage.githubIdentity.connectedUnverified",
                    { login: linkedLogin },
                  )
                : t("settings:informationPage.githubIdentity.notConnected")}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {linkedLogin ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={isBusy}
                onClick={handleUnlink}
              >
                {t("settings:informationPage.githubIdentity.unlink")}
              </Button>
            ) : null}
            <Button
              size="sm"
              type="button"
              disabled={isBusy || !canSave}
              onClick={handleSave}
            >
              {isLinking
                ? t("settings:informationPage.githubIdentity.linking")
                : t("settings:informationPage.githubIdentity.link")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GithubIdentityCard;
